/**
 * Prompt Editor window — Bun side
 *
 * HTTP server + BrowserWindow for CRUD operations on prompt .md files.
 * Mirrors the pattern used by picker and settings windows.
 */
import { BrowserWindow } from "electrobun/bun";
import { fetchModels } from "./llm";
import { createLogger } from "./logger";
import { getSettings } from "./settings";
import { bindWindowStatePersistence, getWindowFrame } from "./window-state";
import { showWindowWhenReady } from "./window-show";
import { validateHotkeySpec } from "./hotkeys";
import { createCustomWindow, ensureWindowServer } from "./framework/custom-window";
import {
  getPrompts,
  savePrompt,
  deletePrompt,
  type Prompt,
  type Provider,
} from "./prompts";

const log = createLogger("editor-window");
type WindowCallbacks = { onOpen?: () => void; onClose?: () => void };

let editorWindow: BrowserWindow | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let serverPort: number | null = null;
let onWindowOpen: () => void = () => {};
let onWindowClose: () => void = () => {};

/** Serialize all prompts to a flat array the webview can use. */
function serializePrompts(): Array<{
  name: string;
  body: string;
  provider: string;
  model: string;
  hotkey: string;
  confirm: boolean;
  selectAllIfEmpty: boolean | null;
  category: string;
}> {
  const prompts = getPrompts();
  return Array.from(prompts.values())
    .map((p) => ({
      name: p.name,
      body: p.body,
      provider: p.provider ?? "",
      model: p.model ?? "",
      hotkey: p.hotkey ?? "",
      confirm: p.confirm,
      selectAllIfEmpty: p.selectAllIfEmpty,
      category: p.category ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureServer(): Promise<number> {
  if (serverPort !== null) return serverPort;

  const started = await ensureWindowServer({
    log,
    viewName: "editor",
    headScript: (port) => `window.__EDITOR_PORT__ = ${port}; window.__EDITOR_RESIZABLE__ = true;`,
    context: {
      windowRef: () => editorWindow,
      clearWindowRef: () => {
        editorWindow = null;
      },
      log,
    },
    async handleRequest(req, path) {
      if (req.method === "GET" && path === "/state") {
        const settings = getSettings();
        return Response.json({
          prompts: serializePrompts(),
          defaultProvider: settings.provider,
        });
      }

      // ── POST /models — list models for a provider ──────────────────
      if (req.method === "POST" && path === "/models") {
        const body = (await req.json()) as { provider: string };
        const provider = (body.provider || getSettings().provider) as Provider;
        const apiKey = getSettings().apiKeys[provider]?.trim();

        if (!apiKey) {
          return Response.json({ models: [] });
        }

        try {
          const models = await fetchModels(provider, apiKey);
          return Response.json({
            models: models.map((id) => ({ id, name: id })),
          });
        } catch (error) {
          log.error("models.failed", { provider, error });
          return Response.json({ models: [] });
        }
      }

      // ── POST /save — create or update a prompt ─────────────────────
      if (req.method === "POST" && path === "/save") {
        const body = (await req.json()) as {
          oldName: string;
          name: string;
          body: string;
          provider: string;
          model: string;
          hotkey: string;
          category: string;
          confirm: boolean;
          selectAllIfEmpty: "true" | "false" | "default";
        };

        log.info("save.requested", { oldName: body.oldName, name: body.name });
        const normalizedName = body.name.trim();
        if (!normalizedName) {
          return Response.json({ error: "Name cannot be empty." }, { status: 400 });
        }
        const duplicate = getPrompts().get(normalizedName);
        if (duplicate && body.oldName !== normalizedName) {
          return Response.json({ error: `A prompt named "${normalizedName}" already exists.` }, { status: 400 });
        }
        if (body.hotkey) {
          const validation = validateHotkeySpec(body.hotkey);
          if (!validation.ok) {
            return Response.json({ error: validation.errors.join(" "), validation }, { status: 400 });
          }
        }

        // If renaming, delete the old file first
        if (body.oldName && body.oldName !== body.name) {
          await deletePrompt(body.oldName);
        }

        // Reuse the existing file path when updating (avoid creating duplicates)
        const existing = body.oldName ? getPrompts().get(body.oldName) : null;
        const prompt: Prompt = {
          name: normalizedName,
          body: body.body,
          provider: (body.provider as Provider) || null,
          model: body.model || null,
          hotkey: body.hotkey || null,
          category: body.category.trim() || null,
          confirm: body.confirm,
          selectAllIfEmpty: body.selectAllIfEmpty === "true"
            ? true
            : body.selectAllIfEmpty === "false"
              ? false
              : null,
          filePath: existing?.filePath ?? "",
        };

        await savePrompt(prompt);

        // Wait briefly for the watcher to pick up the change
        await Bun.sleep(200);

        return Response.json({ prompts: serializePrompts() });
      }

      // ── POST /delete — delete a prompt ─────────────────────────────
      if (req.method === "POST" && path === "/delete") {
        const body = (await req.json()) as { name: string };
        log.info("delete.requested", { name: body.name });
        await deletePrompt(body.name);

        await Bun.sleep(200);

        return Response.json({ prompts: serializePrompts() });
      }

    },
  });
  server = started.server;
  serverPort = started.port;
  return serverPort;
}

export async function initEditorWindow(callbacks?: WindowCallbacks): Promise<void> {
  if (callbacks?.onOpen) onWindowOpen = callbacks.onOpen;
  if (callbacks?.onClose) onWindowClose = callbacks.onClose;
  await ensureServer();
}

export async function showEditorWindow(): Promise<void> {
  const port = await ensureServer();

  if (editorWindow) {
    try {
      editorWindow.show();
      editorWindow.setAlwaysOnTop(true);
      editorWindow.setAlwaysOnTop(false);
      log.info("window.reused");
      return;
    } catch {
      editorWindow = null;
    }
  }

  const frame = getWindowFrame("editor");
  log.info("window.creating", frame);
  onWindowOpen();
  editorWindow = createCustomWindow(
    "Prompt Editor",
    { x: frame.x, y: frame.y, width: frame.w, height: frame.h },
    `http://localhost:${port}/`,
    { transparent: false },
  );

  bindWindowStatePersistence(editorWindow, "editor");
  editorWindow.on("close", () => {
    editorWindow = null;
    onWindowClose();
  });
  showWindowWhenReady(editorWindow, log, "window");
}
