/**
 * Prompt Editor window — Bun side
 *
 * HTTP server + BrowserWindow for CRUD operations on prompt .md files.
 * Mirrors the pattern used by picker and settings windows.
 */

import { resolve } from "node:path";
import { BrowserWindow } from "electrobun/bun";
import { fetchModels } from "./llm";
import { createLogger } from "./logger";
import { getSettings } from "./settings";
import { bindWindowStatePersistence, getWindowFrame } from "./window-state";
import {
  getPrompts,
  savePrompt,
  deletePrompt,
  PROMPTS_DIR,
  type Prompt,
  type Provider,
} from "./prompts";

const log = createLogger("editor-window");

let editorWindow: BrowserWindow | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let serverPort: number | null = null;

const builtViewDir = resolve(import.meta.dir, "../views/editor");
const srcViewDir = resolve(process.cwd(), "src/views/editor");

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
      throw new Error(result.logs.map((e) => e.message).join("\n"));
    }
    js = await result.outputs[0].text();
  } else {
    throw new Error(`editor view not found: ${builtJs} | ${srcTs}`);
  }

  const builtHtml = resolve(builtViewDir, "index.html");
  const srcHtml = resolve(srcViewDir, "index.html");
  const htmlPath = (await fileExists(builtHtml)) ? builtHtml : srcHtml;
  const html = await Bun.file(htmlPath).text();

  return { js, html };
}

/** Serialize all prompts to a flat array the webview can use. */
function serializePrompts(): Array<{
  name: string;
  body: string;
  provider: string;
  model: string;
  hotkey: string;
  confirm: boolean;
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
      category: p.category ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

      // ── Static assets ──────────────────────────────────────────────
      if (path === "/" || path === "/index.html") {
        const payload = finalHtml.replace(
          "</head>",
          `<script>window.__EDITOR_PORT__ = ${server!.port}; window.__EDITOR_RESIZABLE__ = true;</script>\n</head>`,
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

      // ── GET /state — all prompts + default provider ────────────────
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
          confirm: boolean;
        };

        log.info("save.requested", { oldName: body.oldName, name: body.name });

        // If renaming, delete the old file first
        if (body.oldName && body.oldName !== body.name) {
          await deletePrompt(body.oldName);
        }

        // Reuse the existing file path when updating (avoid creating duplicates)
        const existing = body.oldName ? getPrompts().get(body.oldName) : null;
        const prompt: Prompt = {
          name: body.name,
          body: body.body,
          provider: (body.provider as Provider) || null,
          model: body.model || null,
          hotkey: body.hotkey || null,
          category: null,
          confirm: body.confirm,
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

      // ── POST /close — close the editor window ─────────────────────
      if (req.method === "POST" && path === "/close") {
        log.info("close.requested");
        if (editorWindow) {
          try { editorWindow.close(); } catch {}
          editorWindow = null;
        }
        return new Response("ok");
      }

      if (req.method === "POST" && path === "/window/resize") {
        const body = await req.json() as { width?: number; height?: number };
        if (editorWindow && body.width && body.height) {
          editorWindow.setSize(body.width, body.height);
        }
        return new Response("ok");
      }

      // ── POST /log — structured logging from webview ────────────────
      if (req.method === "POST" && path === "/log") {
        const body = (await req.json()) as {
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

export async function initEditorWindow(): Promise<void> {
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
  editorWindow = new BrowserWindow({
    title: "Prompt Editor",
    frame: { x: frame.x, y: frame.y, width: frame.w, height: frame.h },
    url: `http://localhost:${port}/`,
    html: null,
    titleBarStyle: "hidden",
    transparent: false,
  });

  bindWindowStatePersistence(editorWindow, "editor");
  editorWindow.show();
}
