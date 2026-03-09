import { resolve } from "node:path";
import { BrowserWindow } from "electrobun/bun";
import { fetchModels } from "./llm";
import { createLogger } from "./logger";
import { getSettings, saveSettings, type Settings } from "./settings";
import type { Provider } from "./prompts";

const log = createLogger("settings-window");

type SettingsUpdateHandler = (settings: Settings) => Promise<void> | void;

let onSettingsUpdated: SettingsUpdateHandler = () => {};
let settingsWindow: BrowserWindow | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let serverPort: number | null = null;

const builtViewDir = resolve(import.meta.dir, "../views/settings");
const srcViewDir = resolve(process.cwd(), "src/views/settings");

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
    throw new Error(`settings view not found: ${builtJs} | ${srcTs}`);
  }

  const builtHtml = resolve(builtViewDir, "index.html");
  const srcHtml = resolve(srcViewDir, "index.html");
  const htmlPath = (await fileExists(builtHtml)) ? builtHtml : srcHtml;
  const html = await Bun.file(htmlPath).text();

  return { js, html };
}

function sanitizeSettings(input: Settings): Settings {
  return {
    provider: input.provider,
    model: input.model.trim(),
    apiKeys: {
      openrouter: input.apiKeys.openrouter.trim(),
      openai: input.apiKeys.openai.trim(),
      anthropic: input.apiKeys.anthropic.trim(),
      xai: input.apiKeys.xai.trim(),
    },
    maxTokens: Math.max(1, Math.round(Number(input.maxTokens) || 8192)),
    hotkeys: {
      promptChat: input.hotkeys.promptChat.trim(),
      promptPicker: input.hotkeys.promptPicker.trim(),
      reload: input.hotkeys.reload.trim(),
    },
    windows: {
      chat: input.windows.chat,
      picker: input.windows.picker,
      settings: input.windows.settings,
      editor: input.windows.editor,
    },
    onboarded: Boolean(input.onboarded),
  };
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
          `<script>window.__SETTINGS_PORT__ = ${server!.port};</script>\n</head>`,
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
        return Response.json(getSettings());
      }

      if (req.method === "POST" && path === "/models") {
        const body = await req.json() as { provider: Provider; apiKey?: string };
        const provider = body.provider;
        const apiKey = (body.apiKey ?? getSettings().apiKeys[provider]).trim();
        log.info("models.requested", { provider, hasKey: Boolean(apiKey) });

        if (!apiKey) {
          return Response.json({ models: [], error: `Missing API key for ${provider}` }, { status: 400 });
        }

        try {
          const models = await fetchModels(provider, apiKey);
          return Response.json({ models });
        } catch (error) {
          log.error("models.failed", { provider, error });
          return Response.json(
            { models: [], error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      }

      if (req.method === "POST" && path === "/save") {
        const next = sanitizeSettings(await req.json() as Settings);
        log.info("save.requested", {
          provider: next.provider,
          model: next.model,
          maxTokens: next.maxTokens,
        });
        await saveSettings(next);
        const updated = getSettings();
        await onSettingsUpdated(updated);
        return Response.json(updated);
      }

      if (req.method === "POST" && path === "/close") {
        log.info("close.requested");
        if (settingsWindow) {
          try { settingsWindow.close(); } catch {}
          settingsWindow = null;
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

      return new Response("Not found", { status: 404 });
    },
  });

  serverPort = server.port;
  log.info("server.ready", { port: serverPort });
  return serverPort;
}

export async function initSettingsWindow(handler: SettingsUpdateHandler): Promise<void> {
  onSettingsUpdated = handler;
  await ensureServer();
}

export async function showSettingsWindow(): Promise<void> {
  const port = await ensureServer();

  if (settingsWindow) {
    try {
      settingsWindow.show();
      settingsWindow.setAlwaysOnTop(true);
      settingsWindow.setAlwaysOnTop(false);
      log.info("window.reused");
      return;
    } catch {
      settingsWindow = null;
    }
  }

  const size = getSettings().windows.settings;
  log.info("window.creating", size);
  settingsWindow = new BrowserWindow({
    title: "Settings",
    frame: { x: 360, y: 120, width: size.w, height: size.h },
    url: `http://localhost:${port}/`,
    html: null,
    titleBarStyle: "hidden",
    transparent: false,
  });

  settingsWindow.show();
}
