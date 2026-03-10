import { resolve } from "node:path";
import { Tray } from "electrobun/bun";
import { formatHotkeyForDisplay, registerHotkey, unregisterHotkey, unregisterAll, updateHotkey } from "./hotkeys";
import { initPrompts, type PromptMap } from "./prompts";
import { loadSettings, getSettings, type Settings } from "./settings";
import { silentReplace, setToastCallback, type ReplaceResult } from "./replace";
import { handleReplaceStatus } from "./feedback";
import { showPicker, updatePickerPrompts, initPickerServer } from "./picker";
import { initMainWindow, showMainWindow } from "./mainview-window";
import { initSettingsWindow, showSettingsWindow } from "./settings-window";
import { initEditorWindow, showEditorWindow } from "./editor-window";
import { createLogger, getLogFilePath, resetLogFile } from "./logger";
import { syncLaunchAtStartup } from "./startup";

const log = createLogger("startup");
resetLogFile();
log.info("session.started", { logFile: getLogFilePath() });

// ─── Boot sequence ────────────────────────────────────────────────────────────

const settings = await loadSettings();

// Toast: shown after a silent replace (real window comes later)
setToastCallback((r: ReplaceResult) => {
  log.info("replace.toast_ready", {
    originalChars: r.original.length,
    resultChars: r.result.length,
  });
});
log.info("settings.loaded", {
  provider: settings.provider,
  model: settings.model,
  onboarded: settings.onboarded,
});
syncLaunchAtStartup(settings);

// ─── Tray ─────────────────────────────────────────────────────────────────────

const trayIcon = resolve(import.meta.dir, "../assets/tray-icon.ico");
const tray = new Tray({ title: "Assistant", image: trayIcon, width: 32, height: 32 });

function withHotkeyLabel(label: string, hotkey?: string): string {
  const normalized = hotkey?.trim();
  return normalized ? `${label}    ${formatHotkeyForDisplay(normalized)}` : label;
}

function updateTrayMenu(settings: Settings): void {
  tray.setMenu([
    {
      type: "normal",
      label: withHotkeyLabel("Open Chat", settings.hotkeys.promptChat),
      action: "open",
    },
    {
      type: "normal",
      label: withHotkeyLabel("Prompt Picker", settings.hotkeys.promptPicker),
      action: "picker",
    },
    { type: "normal", label: "Prompt Editor", action: "editor" },
    { type: "divider" },
    { type: "normal", label: "Settings", action: "settings" },
    { type: "divider" },
    { type: "normal", label: "Quit", action: "quit" },
  ]);
}

updateTrayMenu(settings);

tray.on("tray-clicked", (event: any) => {
  const action = event.data?.action;
  switch (action) {
    case "open":
      log.info("tray.open_chat");
      showMainWindow().catch((error) => log.error("tray.open_chat_failed", { error }));
      break;
    case "settings":
      log.info("tray.open_settings");
      showSettingsWindow().catch((error) => log.error("tray.open_settings_failed", { error }));
      break;
    case "picker":
      log.info("tray.open_picker");
      showPicker().catch((error) => log.error("tray.open_picker_failed", { error }));
      break;
    case "editor":
      log.info("tray.open_editor");
      showEditorWindow().catch((error) => log.error("tray.open_editor_failed", { error }));
      break;
    case "quit":
      log.info("tray.quit");
      unregisterAll();
      tray.remove();
      process.exit(0);
      break;
  }
});

// ─── Prompt hotkeys ───────────────────────────────────────────────────────────

let activePromptHotkeys = new Set<string>();

function applyPromptHotkeys(prompts: PromptMap): void {
  for (const name of activePromptHotkeys) {
    if (!prompts.has(name)) {
      unregisterHotkey(`prompt:${name}`);
      activePromptHotkeys.delete(name);
    }
  }

  for (const [name, prompt] of prompts) {
    if (!prompt.hotkey) continue;

    const key = `prompt:${name}`;
    if (activePromptHotkeys.has(name)) unregisterHotkey(key);

    const ok = registerHotkey(key, prompt.hotkey, (context) => {
      log.info("prompt.hotkey_triggered", { name, hotkey: prompt.hotkey });
      if (prompt.confirm) {
        log.info("prompt.confirm_not_implemented", { name });
        return;
      }
      silentReplace(prompt, {
        inputText: context?.preCaptured?.text,
        hwnd: context?.preCaptured?.hwnd,
        savedClipboard: context?.preCaptured?.savedClipboard,
        onStatus: handleReplaceStatus,
      }).catch((e) =>
        log.error("prompt.replace_failed", { name, error: e })
      );
    });

    if (ok) {
      activePromptHotkeys.add(name);
    } else {
      log.warn("prompt.hotkey_register_failed", { name, hotkey: prompt.hotkey });
    }
  }
}

// ─── System hotkeys ───────────────────────────────────────────────────────────

function handlePromptChat(): void {
  log.info("hotkey.prompt_chat_triggered");
  showMainWindow().catch((error) => log.error("hotkey.prompt_chat_failed", { error }));
}

function handlePromptPicker(): void {
  log.info("hotkey.prompt_picker_triggered");
  showPicker().catch((error) => log.error("hotkey.prompt_picker_failed", { error }));
}

function handleReload(): void {
  log.info("hotkey.reload_triggered");
}

function applySystemHotkeys(settings: Settings): void {
  if (settings.hotkeys.promptChat) {
    updateHotkey("promptChat", settings.hotkeys.promptChat, handlePromptChat);
  } else {
    unregisterHotkey("promptChat");
  }

  if (settings.hotkeys.promptPicker) {
    updateHotkey("promptPicker", settings.hotkeys.promptPicker, handlePromptPicker);
  } else {
    unregisterHotkey("promptPicker");
  }

  if (settings.hotkeys.reload) {
    updateHotkey("reload", settings.hotkeys.reload, handleReload);
  } else {
    unregisterHotkey("reload");
  }

  log.info("system_hotkeys.updated", settings.hotkeys);
}

applySystemHotkeys(getSettings());

// ─── Prompts ──────────────────────────────────────────────────────────────────

const prompts = await initPrompts((updated) => {
  applyPromptHotkeys(updated);
  updatePickerPrompts(updated);
});

applyPromptHotkeys(prompts);
updatePickerPrompts(prompts);

// Start the picker HTTP server now.
await initMainWindow();
await initPickerServer();
await initSettingsWindow(async (nextSettings) => {
  applySystemHotkeys(nextSettings);
  updateTrayMenu(nextSettings);
  syncLaunchAtStartup(nextSettings);
  log.info("settings.applied", {
    provider: nextSettings.provider,
    model: nextSettings.model,
  });
});
await initEditorWindow();

// Keep the Bun event loop alive indefinitely.
// Without this, Bun may drain the event loop and exit even with active servers.
setInterval(() => {}, 2 ** 30);

log.info("app.ready", { promptCount: prompts.size });
