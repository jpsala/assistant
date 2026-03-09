import { Tray } from "electrobun/bun";
import { registerHotkey, unregisterHotkey, unregisterAll } from "./hotkeys";
import { initPrompts, type PromptMap } from "./prompts";

// ─── Tray ─────────────────────────────────────────────────────────────────────

const tray = new Tray({ title: "Assistant" });

tray.setMenu([
  { type: "normal", label: "Open Chat (Alt+Shift+W)", action: "open" },
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

// ─── Prompt hotkey registry ───────────────────────────────────────────────────

let activePromptHotkeys = new Set<string>();

function applyPromptHotkeys(prompts: PromptMap): void {
  // Unregister removed hotkeys
  for (const name of activePromptHotkeys) {
    if (!prompts.has(name)) {
      unregisterHotkey(`prompt:${name}`);
      activePromptHotkeys.delete(name);
    }
  }

  // Register new / updated hotkeys
  for (const [name, prompt] of prompts) {
    if (!prompt.hotkey) continue;

    const key = `prompt:${name}`;
    const alreadyActive = activePromptHotkeys.has(name);

    // Re-register if hotkey changed (unregister first)
    if (alreadyActive) unregisterHotkey(key);

    const ok = registerHotkey(key, prompt.hotkey, () => {
      console.log(`[hotkey] "${name}" triggered`);
      // TODO: execute silent replace flow
    });

    if (ok) {
      activePromptHotkeys.add(name);
      if (!alreadyActive)
        console.log(`[prompts] registered hotkey "${prompt.hotkey}" → ${name}`);
    } else {
      console.warn(`[prompts] failed to register hotkey "${prompt.hotkey}" for "${name}"`);
    }
  }
}

// ─── System hotkeys ───────────────────────────────────────────────────────────

registerHotkey("promptChat", "Alt+Shift+W", () => {
  console.log("[hotkey] Alt+Shift+W → open prompt chat");
  // TODO: open chat window
});

registerHotkey("promptPicker", "Alt+Shift+Space", () => {
  console.log("[hotkey] Alt+Shift+Space → open prompt picker");
  // TODO: open picker window
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

const prompts = await initPrompts((updated) => {
  applyPromptHotkeys(updated);
});

console.log(`[startup] Assistant running — ${prompts.size} prompts loaded`);
