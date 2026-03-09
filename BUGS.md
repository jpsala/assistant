# Runtime Bugs Status

## What works today

The core picker flow is working:

- Global hotkey opens the prompt picker.
- The picker gets focus and can be searched.
- Selected text is pre-captured before the picker steals focus.
- Choosing a prompt runs the correct prompt on the correct selected text.
- The selected text is replaced with the generated output.
- Structured logs are written to `%APPDATA%\\assistant\\logs\\latest.log`.
- Settings window exists and hotkey changes persist.

## What is still broken

### 1. Feedback tooltip does not really close

Observed behavior:

- The feedback window shows correctly during `processing`, `pasting`, and `success/error`.
- When the toast timeout ends, the window does not behave like a true transient notification.
- From the user perspective it looks minimized or otherwise left behind as a window artifact.

Current log shape:

- `feedback.window.created`
- `feedback.window.reused`
- `feedback.window.hidden`

Even when the log says `window.hidden`, the UX is still wrong.

### 2. Feedback window can become empty / black

Observed behavior:

- The tooltip window can end up blank and black instead of showing the toast content.
- This has happened while iterating on the feedback implementation.
- It suggests the current window reuse / hidden-window strategy is unstable in Electrobun/WebView2.

### 3. Feedback window implementation is still not production-safe

The current tooltip system is functional enough to show status, but not stable enough to be considered finished because:

- it leaves behind a visible/minimized artifact
- it has shown stale content in previous iterations
- it has shown empty/black content in previous iterations
- it previously correlated with app exit/crash behavior

## What we already tried

### A. Disposable feedback window

Implementation:

- Create a fresh `BrowserWindow` per toast/update.
- Close it after timeout with `BrowserWindow.close()`.

Result:

- Bad.
- Multiple feedback webviews accumulated quickly.
- This correlated with process instability and at one point the app exited with code `255`.

### B. Reusable singleton window with `loadURL(...)`

Implementation:

- Keep one feedback `BrowserWindow`.
- Update it with `webview.loadURL(...)`.
- Hide it by moving it off-screen with `setFrame(...)`.

Result:

- Better than recreating windows.
- Avoided immediate app exit in successful runs.
- Still left a minimized/ghost-like window artifact.
- Also produced stale content between runs.

### C. Reusable singleton with cache-busting URL params

Implementation:

- Added nonce query params to each feedback URL.
- Added `Cache-Control: no-store` headers.
- Updated the native window title every time.

Result:

- Did not fully solve the stale/minimized behavior.

### D. Utility window / non-miniaturizable feedback window

Implementation:

- Create the feedback window with:
  - `styleMask.UtilityWindow = true`
  - `styleMask.Miniaturizable = false`
  - `styleMask.Resizable = false`

Result:

- Still did not solve the "it minimizes instead of closing" UX.

### E. Reusable singleton with `loadHTML(...)` instead of HTTP URL

Implementation:

- Removed the toast HTTP server.
- Switched feedback rendering to `webview.loadHTML(renderToastHtml(...))`.

Result:

- Intended to eliminate stale cache/state.
- User still reports the same close/minimize problem.
- User also reports the window can end up empty and black.

## Important conclusions

### The replace flow is not the current bug

The important runtime path is already confirmed working:

- picker opens
- prompt selection works
- prompt executes
- selected text changes correctly

So the current problem is specifically the feedback window lifecycle and rendering behavior.

### The current approach is likely fighting Electrobun window semantics

Based on behavior so far, the unstable piece is not prompt execution but using a real `BrowserWindow` as a toast surface:

- closing it is risky
- hiding it off-screen is not equivalent to dismissing it
- reusing it can produce stale or black content

## Current recommendation

Do not keep iterating blindly on the current `BrowserWindow` toast approach.

The next implementation should be treated as a redesign, not another micro-fix. The most likely options are:

1. Render feedback inside an already-existing app window instead of a dedicated toast window.
2. Use a true native notification / tray notification path if Electrobun supports it.
3. Keep the dedicated window but destroy and recreate it safely only if we can prove app shutdown is no longer tied to window close.

## Files involved

- `src/bun/feedback.ts`
- `src/bun/picker.ts`
- `src/bun/replace.ts`
- `src/bun/ffi.ts`
- `%APPDATA%\\assistant\\logs\\latest.log`

## Most recent observed state

As of March 9, 2026:

- picker flow works
- replace flow works
- feedback appears
- feedback dismissal UX is still broken
- feedback window can become black/empty
