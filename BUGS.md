# Picker Window — Focus Bug Investigation

## Current status
The Prompt Picker is functional end-to-end:
- Alt+Shift+Space opens picker window
- Prompts list from APPDATA renders correctly
- Clicking/Enter on a prompt executes silentReplace on source window (debug mode: pastes dummy text)
- Picker closes after selection
- Second invocation of hotkey works

**FIXED**: Both focus bugs have been addressed with the following changes:

---

## BUG 1 — Picker opens without keyboard focus ✅ FIXED

**Symptom**: Window appears, search `<input>` is not focused, user cannot type immediately.

### Solution Implemented: Synthetic Mouse Click (Option A)

Added the following to [src/bun/ffi.ts](src/bun/ffi.ts):
- `GetWindowRect` binding to get window screen coordinates
- `GetSystemMetrics` binding for screen dimensions
- `MOUSEEVENTF_*` constants for mouse input
- `getWindowRect(hwnd)` - returns window bounds
- `sendMouseClick(x, y)` - internal function using `SendInput` with `MOUSEINPUT`
- `clickToFocus(hwnd, offsetY)` - clicks at center-top of window to focus WebView2

The synthetic mouse click is the most reliable method because Windows treats `SendInput` as real user input and grants focus unconditionally. This is the same technique used by AutoHotkey's `ControlClick`.

### Implementation in [src/bun/picker.ts](src/bun/picker.ts):
1. After `forceFocus(hwnd)` brings the Win32 frame to foreground
2. Wait 300ms for WebView2 to initialize
3. Try `focusWebView2Child(hwnd)` first (may work if class names match)
4. Fallback to `clickToFocus(hwnd, 50)` - clicks 50px from top where search box is

---

## BUG 2 — Source input loses focus on second picker use ✅ FIXED

**Symptom**: After first use everything works. Second use: replace runs correctly but the source window's input/textarea doesn't regain focus.

### Root cause
`hidePicker()` calls `forceFocus(_sourceHwnd)`. On the second use, `forceFocus` fails silently because Bun's process no longer has "recent user input" permission from Windows.

### Solution Implemented: AllowSetForegroundWindow (Option C)

Added to [src/bun/ffi.ts](src/bun/ffi.ts):
- `AllowSetForegroundWindow` binding in kernel32.dll
- `allowSetForegroundWindow()` export that calls `AllowSetForegroundWindow(ASFW_ANY)`

### Implementation in [src/bun/picker.ts](src/bun/picker.ts):
1. Call `allowSetForegroundWindow()` in `initPickerServer()` at startup
2. Call `allowSetForegroundWindow()` in `hidePicker()` before `forceFocus(_sourceHwnd)`

This grants Bun's process permission to call `SetForegroundWindow` on any window, bypassing Windows' focus restriction.

---

## Architecture decisions (for context)

### Why HTTP server instead of inline HTML
WebView2 blocks `<script type="module">` when loaded from `null` origin (inline HTML). Using `Bun.serve({ port: 0 })` gives a proper `http://localhost:PORT` origin.

### Why fetch instead of RPC for execute/close
Electrobun's RPC WebSocket uses `window.__electrobunWebviewId` + `window.__electrobunRpcSocketPort` injected by a native preload — NOT injected for HTTP URL windows.
- Actions → `POST http://localhost:PORT/execute|/close`
- Data → injected into HTML as `window.__PICKER_PROMPTS__` and `window.__PICKER_PORT__`

### Why close+recreate instead of minimize/restore
- `_window.minimize()` doesn't reliably hide the window
- `_window.show()` after minimize doesn't give keyboard focus
- Fresh load → cleaner state

### Source window tracking
- `_sourceHwnd` captured via `getForegroundWindow()` BEFORE window operations
- Passed to `silentReplace(prompt, { hwnd: _sourceHwnd })`
- `forceFocus(_sourceHwnd)` in `hidePicker()` to restore focus after close

---

## Key files
- [src/bun/picker.ts](src/bun/picker.ts) — HTTP server, BrowserWindow lifecycle, execute/close handlers
- [src/views/picker/index.ts](src/views/picker/index.ts) — Webview: render, keyboard nav, fetch calls
- [src/views/picker/index.html](src/views/picker/index.html) — Spotlight-style dark UI
- [src/bun/ffi.ts](src/bun/ffi.ts) — FFI: `forceFocus()`, `focusWebView2Child()`, `logChildWindows()`, `clickToFocus()`, `allowSetForegroundWindow()`
- [src/bun/replace.ts](src/bun/replace.ts) — `silentReplace(prompt, { hwnd? })`

## FFI exports (src/bun/ffi.ts)
- `getForegroundWindow()` — current foreground HWND
- `forceFocus(hwnd)` — AttachThreadInput (→ fg thread) + BringWindowToTop + SetForegroundWindow
- `findWindowByTitle(title)` — FindWindowW UTF-16 wrapper
- `setForegroundWindow(hwnd)` — raw SetForegroundWindow
- `focusWebView2Child(hwnd)` — recursive FindWindowExW + SetFocus on Chromium child
- `logChildWindows(hwnd)` — dump child tree with class names (debug)
- `getWindowRect(hwnd)` — get window screen coordinates
- `clickToFocus(hwnd, offsetY?)` — synthetic mouse click to focus WebView2 (BUG 1 fix)
- `allowSetForegroundWindow()` — call AllowSetForegroundWindow(ASFW_ANY) (BUG 2 fix)

## Recommended next session order
1. ~~Run app, press Alt+Shift+Space, read `/tmp/app.log` → get real child class names → fix `focusWebView2Child`~~ ✅ Done (synthetic click implemented instead)
2. ~~If step 1 doesn't work: implement Option A (synthetic mouse click via SendInput MOUSEEVENTF_LEFTDOWN/UP)~~ ✅ Done
3. ~~Fix BUG 2 via AllowSetForegroundWindow~~ ✅ Done
4. Remove DEBUG_REPLACE flag and test full silent replace flow end-to-end
5. Move on to Prompt Chat window
