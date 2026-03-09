import { Tray } from "electrobun/bun";
import { registerHotkey, unregisterHotkey, unregisterAll } from "./hotkeys";
import { initPrompts, type PromptMap } from "./prompts";
import { loadSettings, getSettings } from "./settings";

// ─── Boot sequence ────────────────────────────────────────────────────────────

const settings = await loadSettings();
console.log(
  `[startup] provider=${settings.provider} model=${settings.model} onboarded=${settings.onboarded}`
);

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
    case "picker":
    case "settings":
      console.log(`[tray] ${action} — window not yet implemented`);
      break;
    case "quit":
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
      console.log(`[hotkey] "${name}" triggered`);
      // TODO: silent replace flow
    });

    if (ok) {
      activePromptHotkeys.add(name);
    } else {
      console.warn(`[prompts] failed to register hotkey "${prompt.hotkey}" for "${name}"`);
    }
  }
}

// ─── System hotkeys ───────────────────────────────────────────────────────────

const cfg = getSettings();

registerHotkey("promptChat", cfg.hotkeys.promptChat, () => {
  console.log("[hotkey] promptChat → open chat window");
  // TODO: open chat window
});

registerHotkey("promptPicker", cfg.hotkeys.promptPicker, () => {
  console.log("[hotkey] promptPicker → open picker");
  // TODO: open picker window
});

// ─── Prompts ──────────────────────────────────────────────────────────────────

const prompts = await initPrompts((updated) => {
  applyPromptHotkeys(updated);
});

console.log(`[startup] Assistant running — ${prompts.size} prompts loaded`);
