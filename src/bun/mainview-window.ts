import { resolve } from "node:path";
import { BrowserWindow } from "electrobun/bun";
import { createPersistentCustomWindow, handleCustomWindowRequest } from "./framework/custom-window";
import {
  allowSetForegroundWindow,
  captureSelectedText,
  clickToFocus,
  findWindowByTitle,
  focusWebView2Child,
  forceFocus,
  getForegroundWindow,
  logChildWindows,
  pasteText,
  writeClipboard,
} from "./ffi";
import { streamCompletion, type Message } from "./llm";
import { createLogger } from "./logger";
import { getPrompts, type Prompt } from "./prompts";
import { getSettings, saveSettings } from "./settings";
import { getWindowFrame } from "./window-state";
import { showWindowWhenReady } from "./window-show";

const log = createLogger("mainview");

let mainWindow: BrowserWindow | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let serverPort: number | null = null;
let onWindowOpen: () => void = () => {};
let onWindowClose: () => void = () => {};
let sourceHwnd: unknown = null;
let originalText = "";
let captureSequence = 0;
let pendingPromptName = "";
let mainWindowHwnd: unknown = null;

const builtViewDir = resolve(import.meta.dir, "../views/mainview");
const srcViewDir = resolve(process.cwd(), "src/views/mainview");

type ChatStatePayload = {
  originalText: string;
  hasSourceApp: boolean;
  provider: string;
  model: string;
  layout: {
    contextTextHeight: number;
    composerHeight: number;
  };
  prompts: Array<{
    name: string;
    provider: string;
    model: string;
    body: string;
  }>;
  selectedPromptName?: string;
};

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

async function resolveAssets(): Promise<{ js: string; html: string }> {
  const builtJs = resolve(builtViewDir, "index.js");
  const srcTs = resolve(srcViewDir, "index.ts");

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
      throw new Error(result.logs.map((entry) => entry.message).join("\n"));
    }
    js = await result.outputs[0].text();
  } else {
    throw new Error(`mainview not found: ${builtJs} | ${srcTs}`);
  }

  const builtHtml = resolve(builtViewDir, "index.html");
  const srcHtml = resolve(srcViewDir, "index.html");
  const htmlPath = (await fileExists(builtHtml)) ? builtHtml : srcHtml;
  const html = await Bun.file(htmlPath).text();

  return { js, html };
}

function serializePrompts(): ChatStatePayload["prompts"] {
  return Array.from(getPrompts().values())
    .filter((prompt) => !prompt.confirm)
    .map((prompt) => ({
      name: prompt.name,
      provider: prompt.provider ?? "",
      model: prompt.model ?? "",
      body: prompt.body,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildSystemPrompt(prompt: Prompt | null, selectedText: string): string | undefined {
  const parts: string[] = [];
  if (selectedText.trim()) {
    parts.push(`Selected text context:\n${selectedText.trim()}`);
  }
  if (prompt?.body.trim()) {
    parts.push(prompt.body.trim());
  }
  const joined = parts.join("\n\n");
  return joined || undefined;
}

function getChatStatePayload(): ChatStatePayload {
  const settings = getSettings();
  return {
    originalText,
    hasSourceApp: Boolean(sourceHwnd),
    provider: settings.provider,
    model: settings.model,
    layout: {
      contextTextHeight: settings.windows.chat.contextTextHeight,
      composerHeight: settings.windows.chat.composerHeight,
    },
    prompts: serializePrompts(),
    selectedPromptName: pendingPromptName || undefined,
  };
}

function syncStateToWindow(): void {
  if (!mainWindow) return;

  try {
    const payload = Buffer.from(
      JSON.stringify(getChatStatePayload()),
      "utf8",
    ).toString("base64");
    mainWindow.webview.executeJavascript(
      `window.__MAINVIEW_APPLY_STATE_FROM_B64?.(${JSON.stringify(payload)});`,
    );
    mainWindow.webview.executeJavascript("window.__MAINVIEW_FOCUS_COMPOSER__?.();");
    setTimeout(() => {
      try {
        mainWindow?.webview.executeJavascript("window.__MAINVIEW_FOCUS_COMPOSER__?.();");
      } catch {}
    }, 120);
    log.info("window.state_synced", {
      chars: originalText.length,
      hasText: Boolean(originalText.trim()),
      selectedPromptName: pendingPromptName || null,
    });
    pendingPromptName = "";
  } catch (error) {
    log.warn("window.state_sync_failed", { error });
  }
}

function focusChatWindowNative(): void {
  (async () => {
    allowSetForegroundWindow();
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(100);
      const hwnd = findWindowByTitle("Prompt Chat");
      if (!hwnd) continue;

      mainWindowHwnd = hwnd;
      forceFocus(hwnd);
      await Bun.sleep(300);

      const focused = focusWebView2Child(hwnd);
      if (!focused) {
        logChildWindows(hwnd);
        clickToFocus(hwnd, 120);
      }

      try {
        mainWindow?.webview.executeJavascript("window.__MAINVIEW_FOCUS_COMPOSER__?.();");
      } catch {}

      log.info("window.native_focus_applied", { hwnd, focused });
      break;
    }
  })().catch((error) => {
    log.warn("window.native_focus_failed", { error });
  });
}

function createMainWindow(port: number): BrowserWindow {
  const frame = getWindowFrame("chat");
  const window = createPersistentCustomWindow(
    "chat",
    "Prompt Chat",
    `http://localhost:${port}/`,
    { transparent: false, logger: log },
  );

  window.on("close", () => {
    mainWindow = null;
    mainWindowHwnd = null;
    onWindowClose();
  });
  log.info("window.created", { frame });
  return window;
}

async function ensureServer(): Promise<number> {
  if (serverPort !== null) return serverPort;

  const { js, html } = await resolveAssets();
  const finalHtml = html.replace(
    /<script type="module" src="index\.ts"><\/script>/,
    `<script type="module" src="/index.js"></script>`,
  );

  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/" || path === "/index.html") {
        const payload = finalHtml.replace(
          "</head>",
          `<script>window.__MAINVIEW_PORT__ = ${server!.port}; window.__MAINVIEW_RESIZABLE__ = true;</script>\n</head>`,
        );
        return new Response(payload, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (path === "/index.js") {
        return new Response(js, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }

      if (req.method === "GET" && path === "/state") {
        return Response.json(getChatStatePayload());
      }

      if (req.method === "POST" && path === "/chat/stream") {
        const body = await req.json() as {
          messages: Message[];
          promptName?: string;
          selectedText?: string;
        };

        const settings = getSettings();
        const prompt = body.promptName ? getPrompts().get(body.promptName) ?? null : null;
        const provider = prompt?.provider ?? settings.provider;
        const model = prompt?.model ?? settings.model;
        const apiKey = settings.apiKeys[provider];

        if (!apiKey) {
          return Response.json({ error: `Missing API key for ${provider}` }, { status: 400 });
        }

        const selectedText = typeof body.selectedText === "string"
          ? body.selectedText
          : originalText;

        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const send = (event: string, payload: Record<string, unknown>) => {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
              );
            };

            send("start", { provider, model });

            await streamCompletion(
              {
                provider,
                model,
                apiKey,
                messages: body.messages,
                systemPrompt: buildSystemPrompt(prompt, selectedText),
                maxTokens: settings.maxTokens,
              },
              {
                onToken(token) {
                  send("delta", { delta: token });
                },
                onDone(fullText) {
                  send("done", { content: fullText, provider, model });
                  controller.close();
                },
                onError(error) {
                  send("error", { error: error.message });
                  controller.close();
                },
              },
            );
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      }

      if (req.method === "POST" && path === "/copy") {
        const body = await req.json() as { text?: string };
        writeClipboard(body.text ?? "");
        return new Response("ok");
      }

      if (req.method === "POST" && path === "/replace") {
        const body = await req.json() as { text?: string };
        if (sourceHwnd && body.text?.trim()) {
          allowSetForegroundWindow();
          await pasteText(body.text, sourceHwnd, null);
        }
        return new Response("ok");
      }

      if (req.method === "POST" && path === "/paste") {
        const body = await req.json() as { text?: string };
        if (sourceHwnd && body.text?.trim()) {
          allowSetForegroundWindow();
          await pasteText(body.text, sourceHwnd, null);
        }
        return new Response("ok");
      }

      // Use forceFocus (AttachThreadInput + SetForegroundWindow) for post-resize
      // focus recapture — more reliable than the setAlwaysOnTop flip in the
      // generic handleCustomWindowRequest handler.
      if (req.method === "POST" && path === "/window/focus") {
        const hwnd = mainWindowHwnd;
        if (hwnd) {
          allowSetForegroundWindow();
          forceFocus(hwnd);
          setTimeout(() => { focusWebView2Child(hwnd); }, 60);
        } else {
          try {
            mainWindow?.show();
            mainWindow?.focus();
            mainWindow?.setAlwaysOnTop(true);
            mainWindow?.setAlwaysOnTop(false);
          } catch {}
        }
        return new Response("ok");
      }

      const handled = await handleCustomWindowRequest(req, path, () => mainWindow, log);
      if (handled) return handled;

      if (req.method === "POST" && path === "/layout") {
        const body = await req.json() as { contextTextHeight?: number; composerHeight?: number };
        const current = getSettings().windows.chat;
        const next = {
          ...current,
          contextTextHeight: Math.max(72, Math.round(body.contextTextHeight ?? current.contextTextHeight)),
          composerHeight: Math.max(72, Math.round(body.composerHeight ?? current.composerHeight)),
        };
        await saveSettings({
          windows: {
            ...getSettings().windows,
            chat: next,
          },
        });
        return Response.json(next);
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

      return new Response("Not found", { status: 404 });
    },
  });

  serverPort = server.port;
  log.info("server.ready", { port: serverPort });
  return serverPort;
}

export async function initMainWindow(callbacks?: {
  onOpen?: () => void;
  onClose?: () => void;
}): Promise<void> {
  if (callbacks?.onOpen) onWindowOpen = callbacks.onOpen;
  if (callbacks?.onClose) onWindowClose = callbacks.onClose;
  await ensureServer();
}

export async function showMainWindow(): Promise<void> {
  log.info("show.requested", { hasExistingWindow: Boolean(mainWindow) });
  const fg = getForegroundWindow();
  sourceHwnd = fg;
  originalText = "";
  const currentCapture = ++captureSequence;

  try {
    const captured = await captureSelectedText(fg);
    if (currentCapture === captureSequence) {
      originalText = captured.text;
      sourceHwnd = captured.hwnd;
      log.info("show.pre_capture_completed", {
        hwnd: captured.hwnd,
        chars: captured.text.length,
        hasText: Boolean(captured.text.trim()),
      });
    } else {
      log.info("show.pre_capture_superseded", { currentCapture, captureSequence });
    }
  } catch (error) {
    if (currentCapture === captureSequence) {
      originalText = "";
      log.warn("show.pre_capture_failed", { error });
    }
  }

  const port = await ensureServer();

  if (mainWindow) {
    // Reuse existing window — do NOT call onWindowOpen() here.
    // It was called when the window was created; calling it again would
    // increment hotkeyPauseDepth without a matching onWindowClose(), causing
    // hotkeys to stay permanently paused after the window closes.
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setAlwaysOnTop(false);
    syncStateToWindow();
    focusChatWindowNative();
    log.info("window.reused");
    return;
  }

  onWindowOpen();
  try {
    mainWindow = createMainWindow(port);
    showWindowWhenReady(mainWindow, log, "window", () => {
      syncStateToWindow();
      focusChatWindowNative();
    });
    log.info("window.shown");
  } catch (error) {
    mainWindow = null;
    onWindowClose();
    throw error;
  }
}

/**
 * Open the chat window pre-loaded with already-captured text and a prompt pre-selected.
 * Used by @confirm:true hotkeys — caller must capture text before calling this
 * (to avoid losing focus to the chat window during capture).
 */
export async function showMainWindowWithContext(
  captured: { text: string; hwnd: unknown; savedClipboard: string | null },
  promptName: string,
): Promise<void> {
  sourceHwnd = captured.hwnd;
  originalText = captured.text;
  pendingPromptName = promptName;

  const port = await ensureServer();

  if (!mainWindow) {
    onWindowOpen();
    try {
      mainWindow = createMainWindow(port);
      showWindowWhenReady(mainWindow, log, "window", () => {
        syncStateToWindow();
        focusChatWindowNative();
      });
      return;
    } catch (error) {
      mainWindow = null;
      onWindowClose();
      throw error;
    }
  }

  // Reuse existing window — do NOT call onWindowOpen() (same reason as showMainWindow).
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.setAlwaysOnTop(false);
  syncStateToWindow();
  focusChatWindowNative();
  log.info("window.shown_with_context", { promptName, chars: originalText.length });
}
