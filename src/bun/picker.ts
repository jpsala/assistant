/**
 * Prompt Picker window — Bun side
 *
 * Spotlight-style window for selecting and executing prompts.
 * Created lazily on first showPicker() call; minimized/restored thereafter.
 *
 * Architecture:
 *   - Serves picker HTML+JS via a Bun HTTP server on a random localhost port.
 *     This gives WebView2 a proper HTTP origin, enabling ES modules and
 *     WebSocket connections without the restrictions of inline-HTML loading.
 *   - RPC over Electrobun's WebSocket transport for prompt data and events.
 *
 * Exports:
 *   showPicker()               — show the picker window
 *   updatePickerPrompts(map)   — push updated prompt list to open picker
 */

import { resolve } from "path";
import { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";
import type { ElectrobunRPCSchema } from "electrobun/bun";
import type { PromptMap, Prompt } from "./prompts";
import { silentReplace } from "./replace";
import { handleReplaceStatus } from "./feedback";
import { captureSelectedText, getForegroundWindow, findWindowByTitle, forceFocus, focusWebView2Child, logChildWindows, pasteText, clickToFocus, allowSetForegroundWindow } from "./ffi";
import { createLogger } from "./logger";

const log = createLogger("picker");

// Set to true to skip LLM calls and paste dummy text — useful for testing
// the window/focus flow without spending API credits.
const DEBUG_REPLACE = false;

// ─── Shared types ─────────────────────────────────────────────────────────────

export type PromptInfo = {
  name: string;
  displayName: string;
  category: string;
  hotkey?: string;
};

// ─── RPC schema (must stay in sync with src/views/picker/index.ts) ───────────

interface PickerSchema extends ElectrobunRPCSchema {
  bun: {
    requests: Record<string, never>;
    messages: {
      "execute": { name: string };
      "close": undefined;
    };
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      "set-prompts": { prompts: PromptInfo[] };
    };
  };
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _prompts: PromptMap = new Map();
let _window: BrowserWindow | null = null;
let _server: ReturnType<typeof Bun.serve> | null = null; // held at module scope to prevent GC
let _serverPort: number | null = null;
let _sourceHwnd: unknown = null; // foreground window captured before picker opens
let _pickerHwnd: unknown = null;  // HWND of the picker frame (set after window creation)
let _capturedInputText: string | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toPromptInfo(name: string, p: Prompt): PromptInfo {
  return {
    name,
    displayName: p.name ?? name,
    category: p.category ?? "general",
    hotkey: p.hotkey,
  };
}

function getPromptInfos(): PromptInfo[] {
  return Array.from(_prompts.entries()).map(([name, p]) =>
    toPromptInfo(name, p),
  );
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

// import.meta.dir at runtime = .../Resources/app/bun/ (built output dir).
// The Electrobun build places views at ../views/<name>/ relative to the bun dir.
// CWD in dev mode = project root, used as fallback when built view doesn't exist.
const _builtViewDir = resolve(import.meta.dir, "../views/picker");
const _srcViewDir   = resolve(process.cwd(), "src/views/picker");

async function fileExists(p: string): Promise<boolean> {
  return Bun.file(p).exists();
}

/**
 * Resolve the JS and HTML for the picker view.
 * Priority: built output (Resources/app/views/picker/) → source tree (src/views/picker/).
 */
async function resolvePickerAssets(): Promise<{ js: string; html: string }> {
  // ── JavaScript ────────────────────────────────────────────────────────────
  const builtJs = resolve(_builtViewDir, "index.js");
  const srcTs   = resolve(_srcViewDir,   "index.ts");

  log.debug("assets.resolve_started", { builtJs, srcTs });

  let js: string;
  if (await fileExists(builtJs)) {
    log.info("assets.using_built_js");
    js = await Bun.file(builtJs).text();
  } else if (await fileExists(srcTs)) {
    log.info("assets.bundling_from_source");
    const result = await Bun.build({
      entrypoints: [srcTs],
      target: "browser",
      format: "esm",
    });
    if (!result.success) {
      throw new Error(`[picker] Bun.build failed:\n${result.logs.map(l => l.message).join("\n")}`);
    }
    js = await result.outputs[0].text();
    log.info("assets.bundle_ready", { chars: js.length });
  } else {
    throw new Error(`[picker] cannot find JS.\n  built: ${builtJs}\n  src:   ${srcTs}`);
  }

  // ── HTML ──────────────────────────────────────────────────────────────────
  const builtHtml = resolve(_builtViewDir, "index.html");
  const srcHtml   = resolve(_srcViewDir,   "index.html");
  const htmlPath  = (await fileExists(builtHtml)) ? builtHtml : srcHtml;
  const html      = await Bun.file(htmlPath).text();

  return { js, html };
}

/**
 * Start a local HTTP server for the picker UI.
 * The server serves the HTML on "/" and the JS on "/index.js".
 * This gives WebView2 a proper HTTP origin, enabling ES modules and WebSockets.
 */
async function startPickerServer(): Promise<number> {
  if (_serverPort !== null) return _serverPort;

  const { js, html } = await resolvePickerAssets();

  // The HTML template has `<script type="module" src="index.ts">` —
  // rewrite to point to our served JS file.
  const finalHtml = html.replace(
    /<script type="module" src="index\.ts"><\/script>/,
    `<script type="module" src="/index.js"></script>`,
  );

  const server = Bun.serve({
    port: 0, // OS assigns a free port
    async fetch(req) {
      const url  = new URL(req.url);
      const path = url.pathname;

      // ── Static assets ────────────────────────────────────────────────────
      if (path === "/" || path === "/index.html") {
        // Inject fresh prompts + server port on every request
        const promptsJson = JSON.stringify(getPromptInfos());
        const htmlWithData = finalHtml.replace(
          "</head>",
          `<script>window.__PICKER_PROMPTS__ = ${promptsJson}; window.__PICKER_PORT__ = ${server.port};</script>\n</head>`,
        );
        return new Response(htmlWithData, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (path === "/index.js") {
        return new Response(js, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }

      // ── Actions (POST from webview via fetch) ─────────────────────────────
      if (req.method === "POST" && path === "/execute") {
        const { name } = await req.json() as { name: string };
        log.info("execute.requested", { name, sourceHwnd: _sourceHwnd });
        const prompt = _prompts.get(name);
        if (prompt) {
          const hwnd = _sourceHwnd;
          const inputText = _capturedInputText;
          hidePicker(); // close window so source can regain focus
          if (DEBUG_REPLACE) {
            // Debug mode: skip capture + LLM, paste a dummy string instead.
            // hidePicker() already called forceFocus(_sourceHwnd), so just wait
            // for the window to fully close before pasting.
            (async () => {
              await Bun.sleep(250);
              const dummy = `[DEBUG] prompt "${name}" selected`;
              log.info("execute.debug_paste", { name, hwnd });
              await pasteText(dummy, hwnd, null);
            })();
          } else if (!prompt.confirm) {
            // Delay capture so the picker fully closes and the source window
            // has time to receive focus back from Windows before Ctrl+C
            (async () => {
              await Bun.sleep(250);
              log.info("execute.replace_started", {
                name,
                hwnd,
                hasPreCapturedInput: Boolean(inputText?.trim()),
                inputChars: inputText?.length ?? 0,
              });
              silentReplace(prompt, {
                hwnd,
                inputText: inputText ?? undefined,
                onStatus: handleReplaceStatus,
              }).catch((e) =>
                log.error("execute.replace_failed", { name, error: e }),
              );
            })();
          } else {
            log.info("execute.confirm_not_implemented", { name });
          }
        } else {
          log.warn("execute.unknown_prompt", { name });
        }
        return new Response("ok");
      }

      if (req.method === "POST" && path === "/log") {
        const body = await req.json() as {
          level?: "debug" | "info" | "warn" | "error";
          event?: string;
          meta?: Record<string, unknown>;
        };
        const level = body.level ?? "info";
        const event = body.event ?? "webview.event";
        const meta = body.meta ?? {};
        if (level === "debug") log.debug(`webview.${event}`, meta);
        else if (level === "warn") log.warn(`webview.${event}`, meta);
        else if (level === "error") log.error(`webview.${event}`, meta);
        else log.info(`webview.${event}`, meta);
        return new Response("ok");
      }

      if (req.method === "POST" && path === "/close") {
        log.info("close.requested");
        hidePicker();
        return new Response("ok");
      }

      return new Response("Not found", { status: 404 });
    },
  });

  _server = server; // keep strong reference — prevents GC from closing the server
  _serverPort = server.port;
  log.info("server.ready", { port: _serverPort });
  return _serverPort;
}

// ─── RPC (best-effort — used only to push set-prompts to the webview) ────────

const rpc = defineElectrobunRPC<PickerSchema>("bun", {
  handlers: {
    requests: {},
    messages: {
      "close": () => hidePicker(),
    },
  },
});

// ─── Window lifecycle ─────────────────────────────────────────────────────────

function hidePicker(): void {
  if (!_window) return;
  log.info("window.hide", { sourceHwnd: _sourceHwnd, pickerHwnd: _pickerHwnd });
  _window.close();
  _window = null;
  _pickerHwnd = null;
  // Allow SetForegroundWindow to work when restoring focus to source window.
  // This helps with BUG 2 where source window doesn't regain focus on second use.
  allowSetForegroundWindow();
  // Restore keyboard focus to the source window
  if (_sourceHwnd) forceFocus(_sourceHwnd);
}

/**
 * Show the prompt picker window.
 * Always creates a fresh window so the page reloads, giving the search box
 * keyboard focus immediately. Also captures the foreground window BEFORE
 * showing so the execute flow can target the correct window for capture/paste.
 */
export async function showPicker(): Promise<void> {
  // Capture source window now, before the picker steals focus.
  // If the foreground is the picker itself (e.g. hotkey fired while picker was
  // still active from a previous use), keep the existing _sourceHwnd so we
  // don't accidentally target the picker window.
  const fg = getForegroundWindow();
  if (fg !== _pickerHwnd) {
    _sourceHwnd = fg;
  }
  log.info("show.requested", { sourceHwnd: _sourceHwnd, foregroundHwnd: fg, pickerHwnd: _pickerHwnd });

  try {
    const captured = await captureSelectedText(_sourceHwnd);
    _capturedInputText = captured.text;
    log.info("show.pre_capture_completed", {
      hwnd: captured.hwnd,
      chars: captured.text.length,
      hasText: Boolean(captured.text.trim()),
    });
  } catch (error) {
    _capturedInputText = null;
    log.error("show.pre_capture_failed", { error });
  }

  // Close any existing picker (fresh load ensures keyboard focus in search box)
  if (_window) {
    try { _window.close(); } catch {}
    _window = null;
  }

  const port = await startPickerServer().catch((err) => {
    log.error("server.start_failed", { error: err });
    return null;
  });
  if (port === null) return;

  log.info("window.creating", { port });
  _window = new BrowserWindow({
    title: "Prompt Picker",
    frame: { x: 320, y: 180, width: 640, height: 460 },
    url: `http://localhost:${port}/`,
    html: null,
    titleBarStyle: "hidden",
    transparent: false,
    rpc,
  });

  _window.setAlwaysOnTop(true);
  _window.show();

  // Electrobun's focusWindow doesn't reliably give keyboard focus to WebView2
  // on Windows. Poll until the native window appears, then force-focus via FFI.
  // Also track the picker HWND so showPicker() can skip it when capturing _sourceHwnd.
  (async () => {
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(100);
      const hwnd = findWindowByTitle("Prompt Picker");
      if (hwnd) {
        _pickerHwnd = hwnd;
        forceFocus(hwnd);
        log.info("window.focused", { hwnd });
        
        // WebView2 child window doesn't exist until NavigationCompleted fires.
        // Wait a bit for the page to load, then use synthetic mouse click to focus.
        await Bun.sleep(300); // Wait for WebView2 to initialize
        
        // Log child windows for debugging (helps discover class names)
        logChildWindows(hwnd);
        
        // Try focusWebView2Child first (may work if class names are correct)
        const focused = focusWebView2Child(hwnd);
        if (focused) {
          log.info("window.webview_focus_succeeded", { hwnd });
        } else {
          // Fallback: synthetic mouse click - most reliable method
          // Click near the top-center where the search box is located
          log.warn("window.webview_focus_fallback_click", { hwnd });
          clickToFocus(hwnd, 50); // 50px from top = titlebar + search box area
        }
        break;
      }
    }
  })();

  log.info("window.created");
}

/**
 * Update the internal prompt map.
 * Prompts are injected fresh on every HTTP request to "/", so no push needed.
 */
export function updatePickerPrompts(prompts: PromptMap): void {
  _prompts = prompts;
}

/**
 * Start the picker HTTP server eagerly at app startup.
 * This keeps Bun's event loop alive (Bun.serve holds a ref) so the process
 * doesn't exit when the hotkey hasn't been pressed yet.
 * Also calls AllowSetForegroundWindow to help with focus issues (BUG 2).
 */
export async function initPickerServer(): Promise<void> {
  await startPickerServer();
  // Allow any process to call SetForegroundWindow - helps with BUG 2
  // where source window doesn't regain focus on second picker use.
  allowSetForegroundWindow();
  log.info("init.complete");
}
