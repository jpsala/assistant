# Resize Follow-up

## Workspace

- Branch: `master`
- Repo path: `C:\dev\electro-bun-1`

## Status: RESIZE IS WORKING

The custom window resize is now fully functional. All known issues from the previous session have been fixed. This document is kept for context; no remaining resize bugs are known.

---

## What Was Fixed This Session

### Root cause: WebView2 bounds not updated on resize

`BrowserWindow.setFrame()` calls `ffi.request.setWindowFrame()` which only calls `SetWindowPos` on the outer Win32 HWND. It does **not** call `ICoreWebView2Controller::put_Bounds`. The WebView2 rendering surface stayed at the original size — the expanded OS window area had no WebView2 content, so it was transparent and click-through.

**Fix** (`src/bun/framework/custom-window.ts`):

After every `POST /window/frame` (in both `ensureWindowServer` and `handleCustomWindowRequest`), we now also call:

```ts
// @ts-ignore — Electrobun internal, not in public exports
import { native, toCString } from "../../../node_modules/electrobun/dist/api/bun/proc/native";

// after window.setFrame(x, y, w, h):
const wv = window.webview;
if (wv?.ptr) {
  native.symbols.resizeWebview(wv.ptr, 0, 0, w, h, toCString("[]"));
}
```

`native.symbols.resizeWebview` maps to `ICoreWebView2Controller::put_Bounds` and expands the WebView2 surface to match the new window size.

### Rapid resize block

After the first resize, starting a second resize quickly was blocked. Root cause: the settle overlay (`z-index: 90`, `pointer-events: auto`) was blocking `mousedown` on the resize handles (z-index 50/55) during the 250ms settle period.

**Fixes** (`src/views/framework/window-shell.ts`):

1. **Settle overlay gets `pointer-events: none`** so resize handles are hit-testable during settle:
   ```css
   html[data-resize-settling="on"] .ws-resize-overlay {
     display: block;
     pointer-events: none;
   }
   ```

2. **Cancel settle timer** at the start of each new drag so the old timer can't clear the new drag state:
   ```ts
   if (resizeSettleTimer) { clearTimeout(resizeSettleTimer); resizeSettleTimer = null; }
   root.dataset.resizeSettling = "off";
   ```

3. **Document capture listener** blocks accidental content clicks during settle, but allows resize handles:
   ```ts
   document.addEventListener("mousedown", (event) => {
     if (root.dataset.resizeSettling !== "on") return;
     const target = event.target as Element | null;
     if (target?.closest("[data-resize]")) return;
     event.preventDefault();
     event.stopPropagation();
   }, { capture: true });
   ```

4. **Settle timer reduced** from 250ms → 80ms.

### Earlier fixes (from prior sessions)

- `mouseenter` pre-fetch of `/window/frame` → no async gap inside `mousedown`
- `document.addEventListener("mouseup", onUp, { capture: true })` → overlay's `stopPropagation` can't block `onUp`
- Overlay background `rgba(0,0,0,0.01)` instead of `transparent` → hit-testable
- `touch-action: none` on resize handles
- `/window/focus` in `mainview-window.ts` uses `forceFocus` + `focusWebView2Child` via FFI

---

## Relevant Files

- `src/views/framework/window-shell.ts` — all resize client logic (handles, overlay, settle)
- `src/bun/framework/custom-window.ts` — `/window/frame` endpoint: calls `setFrame` + `resizeWebview`
- `src/bun/mainview-window.ts` — `/window/focus` endpoint with `forceFocus` + `focusWebView2Child`

---

## Next Steps (unrelated to resize)

The resize work is done. Good next steps for future sessions:

1. **Verify all framework windows** — Settings, Prompt Editor, Picker — all use the same shell and should inherit the fix automatically
2. **Formalize shared window actions** — `WindowAction` type, shared shortcut metadata, shared enabled/disabled logic, keyboard binding registry per window
3. **SQLite conversation history** — `bun:sqlite` integration
4. **Onboarding wizard**

## Build / Runtime Notes

- `node_modules/electrobun/.cache/electrobun.exe dev` is the dev command
- Kill before rebuild: `powershell -NoProfile -Command "Get-Process -Name 'bun','electrobun' | Stop-Process -Force"`
- Known `rcedit` icon warnings during build are harmless
