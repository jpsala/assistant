import { BrowserWindow } from "electrobun/bun";
import { fetchModels } from "./llm";
import { createLogger } from "./logger";
import { getSettings, saveSettings, type Settings } from "./settings";
import type { Provider } from "./prompts";
import { getRegisteredHotkeys, validateHotkeySpec } from "./hotkeys";
import { getWindowFrame } from "./window-state";
import { showWindowWhenReady } from "./window-show";
import { createPersistentCustomWindow, ensureWindowServer } from "./framework/custom-window";

const log = createLogger("settings-window");

type SettingsUpdateHandler = (settings: Settings) => Promise<void> | void;
type WindowCallbacks = { onOpen?: () => void; onClose?: () => void };

let onSettingsUpdated: SettingsUpdateHandler = () => {};
let onWindowOpen: () => void = () => {};
let onWindowClose: () => void = () => {};
let settingsWindow: BrowserWindow | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let serverPort: number | null = null;

function sanitizeSettings(input: Settings): Settings {
  return {
    provider: input.provider,
    model: input.model.trim(),
    feedbackStyle: "custom",
    startWithSystem: Boolean(input.startWithSystem),
    selectAllIfEmpty: Boolean(input.selectAllIfEmpty),
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
      lab: input.windows.lab,
    },
    onboarded: Boolean(input.onboarded),
  };
}

async function ensureServer(): Promise<number> {
  if (serverPort !== null) return serverPort;

  const started = await ensureWindowServer({
    log,
    viewName: "settings",
    headScript: (port) => `window.__SETTINGS_PORT__ = ${port}; window.__SETTINGS_RESIZABLE__ = true;`,
    context: {
      windowRef: () => settingsWindow,
      clearWindowRef: () => {
        settingsWindow = null;
      },
      log,
    },
    async handleRequest(req, path) {
      if (req.method === "GET" && path === "/state") {
        return Response.json(getSettings());
      }

      if (req.method === "GET" && path === "/hotkeys/debug") {
        return Response.json({ registered: getRegisteredHotkeys() });
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
        next.onboarded = true;
        const validations = Object.entries(next.hotkeys).map(([name, spec]) => ({
          name,
          spec,
          result: spec ? validateHotkeySpec(spec) : { ok: true, errors: [] },
        }));
        const invalid = validations.filter((entry) => !entry.result.ok);
        if (invalid.length > 0) {
          return Response.json({
            error: invalid.map((entry) => `${entry.name}: ${entry.result.errors.join(" ")}`).join(" | "),
            validations,
          }, { status: 400 });
        }
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
    },
  });
  server = started.server;
  serverPort = started.port;
  return serverPort;
}

export async function initSettingsWindow(
  handler: SettingsUpdateHandler,
  callbacks?: WindowCallbacks,
): Promise<void> {
  onSettingsUpdated = handler;
  if (callbacks?.onOpen) onWindowOpen = callbacks.onOpen;
  if (callbacks?.onClose) onWindowClose = callbacks.onClose;
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

  const frame = getWindowFrame("settings");
  log.info("window.creating", frame);
  onWindowOpen();
  settingsWindow = createPersistentCustomWindow(
    "settings",
    "Settings",
    `http://localhost:${port}/`,
    { transparent: false, logger: log },
  );

  settingsWindow.on("close", () => {
    settingsWindow = null;
    onWindowClose();
  });
  showWindowWhenReady(settingsWindow, log, "window");
}
