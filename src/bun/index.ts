import { Tray } from "electrobun/bun";
import { registerHotkey, unregisterAll } from "./hotkeys";

// ─── Tray ─────────────────────────────────────────────────────────────────────

const tray = new Tray({ title: "Assistant" });

tray.setMenu([
  { type: "normal", label: "Open (Alt+Shift+W)", action: "open" },
  { type: "divider" },
  { type: "normal", label: "Quit", action: "quit" },
]);

tray.on("tray-clicked", (event: any) => {
  const action = event.data?.action;
  switch (action) {
    case "open":
      console.log("[tray] open — window not yet implemented");
      break;
    case "quit":
      unregisterAll();
      tray.remove();
      process.exit(0);
      break;
  }
});

// ─── System hotkeys ───────────────────────────────────────────────────────────

const hotkeyOk = registerHotkey("promptChat", "Alt+Shift+W", () => {
  console.log("[hotkey] Alt+Shift+W → open prompt chat");
});

console.log(
  `[startup] hotkey Alt+Shift+W registered: ${hotkeyOk ? "✅" : "❌"}`
);
console.log("[startup] Assistant running — tray icon active");
