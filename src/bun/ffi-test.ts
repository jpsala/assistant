/**
 * Manual test — run with: bun src/bun/ffi-test.ts
 *
 * What to do:
 *  1. Open Notepad, type "hello world", select all (Ctrl+A)
 *  2. Switch to this terminal and press Enter
 *  3. The script captures the selected text and pastes "REPLACED" back
 */

import {
  captureSelectedText,
  pasteText,
  readClipboard,
  writeClipboard,
  getForegroundWindow,
} from "./ffi";

console.log("─── FFI layer test ───");

// 1. Clipboard read/write round-trip
console.log("\n[1] Clipboard round-trip...");
const original = readClipboard();
console.log("  current clipboard:", JSON.stringify(original));

writeClipboard("test-from-ffi-✓");
const read = readClipboard();
console.log("  after write:", JSON.stringify(read));

if (original !== null) writeClipboard(original);
console.log("  restored:", JSON.stringify(readClipboard()));

const ok = read === "test-from-ffi-✓";
console.log("  result:", ok ? "✅ PASS" : "❌ FAIL");

// 2. GetForegroundWindow
console.log("\n[2] GetForegroundWindow...");
const hwnd = getForegroundWindow();
console.log("  hwnd:", hwnd, hwnd ? "✅ PASS" : "❌ FAIL (null)");

// 3. Capture selected text (interactive)
console.log(
  "\n[3] Capture test — open Notepad, select some text, then press Enter here..."
);
await new Promise<void>((r) => {
  process.stdin.once("data", () => r());
});

const result = await captureSelectedText();
console.log("  captured:", JSON.stringify(result.text));
console.log("  hwnd:", result.hwnd);

if (result.text) {
  const upper = result.text.toUpperCase();
  console.log(`\n[4] Pasting "${upper}" back in 2 seconds...`);
  await Bun.sleep(2000);
  await pasteText(upper, result.hwnd, result.savedClipboard);
  console.log("  ✅ paste done — check Notepad");
} else {
  console.log("  ⚠️  no text captured (was any text selected?)");
}

process.exit(0);
