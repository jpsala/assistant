import { Tray } from "electrobun/bun";
import { registerHotkey, unregisterHotkey, unregisterAll } from "./hotkeys";
import { initPrompts, type PromptMap } from "./prompts";
import { loadSettings, getSettings } from "./settings";
import { silentReplace, setToastCallback, type ReplaceResult } from "./replace";
import { handleReplaceStatus } from "./feedback";
import { showPicker, updatePickerPrompts, initPickerServer } from "./picker";
import { createLogger, getLogFilePath, resetLogFile } from "./logger";

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

// ─── Tray ─────────────────────────────────────────────────────────────────────

const tray = new Tray({ title: "Assistant" });

tray.setMenu([
  { type: "normal", label: "Open Chat", action: "open" },
  { type: "normal", label: "Prompt Picker", action: "picker" },
  { type: "divider" },
  { type: "normal", label: "Settings", action: "settings" },
  { type: "divider" },
  { type: "normal", label: "Quit", action: "quit" },
]);

tray.on("tray-clicked", (event: any) => {
  const action = event.data?.action;
  switch (action) {
    case "open":
    case "settings":
      log.info("tray.action_not_implemented", { action });
      break;
    case "picker":
      log.info("tray.open_picker");
      showPicker().catch((error) => log.error("tray.open_picker_failed", { error }));
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

    const ok = registerHotkey(key, prompt.hotkey, () => {
      log.info("prompt.hotkey_triggered", { name, hotkey: prompt.hotkey });
      if (prompt.confirm) {
        log.info("prompt.confirm_not_implemented", { name });
        return;
      }
      silentReplace(prompt, { onStatus: handleReplaceStatus }).catch((e) =>
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

const cfg = getSettings();

registerHotkey("promptChat", cfg.hotkeys.promptChat, () => {
  log.info("hotkey.prompt_chat_triggered");
});

registerHotkey("promptPicker", cfg.hotkeys.promptPicker, () => {
  log.info("hotkey.prompt_picker_triggered");
  showPicker().catch((error) => log.error("hotkey.prompt_picker_failed", { error }));
});

// ─── Prompts ──────────────────────────────────────────────────────────────────

const prompts = await initPrompts((updated) => {
  applyPromptHotkeys(updated);
  updatePickerPrompts(updated);
});

applyPromptHotkeys(prompts);
updatePickerPrompts(prompts);

// Start the picker HTTP server now.
await initPickerServer();

// Keep the Bun event loop alive indefinitely.
// Without this, Bun may drain the event loop and exit even with active servers.
setInterval(() => {}, 2 ** 30);

log.info("app.ready", { promptCount: prompts.size });
