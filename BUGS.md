# Runtime Bugs Status

## Current state

As of March 9, 2026, the unstable dedicated feedback `BrowserWindow` has been removed from the codebase.

The feedback path now uses native Windows balloon notifications from `src/bun/feedback.ts` via `System.Windows.Forms.NotifyIcon` launched through PowerShell.

What is confirmed:

- picker flow still works in code
- replace flow still works in code
- the app rebuild succeeds after stopping the running Electrobun/Bun processes that lock `build/dev-win-x64`
- the built runtime bundle contains the native balloon notification implementation
- a direct smoke test logged:
  - `feedback.status.received`
  - `feedback.balloon.spawned`

## Previous bug status

The old issues below applied to the retired `BrowserWindow` toast implementation:

- feedback tooltip did not really close
- feedback window could become empty or black
- feedback window lifecycle was not production-safe

Those issues are no longer the current code path. They should be treated as historical notes, not the active implementation problem.

## What changed

The redesign is already implemented in:

- `src/bun/feedback.ts`

It now:

- skips transient `capturing` and `pasting` states
- shows native notifications for `processing`, `success`, and `error`
- avoids creating, hiding, reusing, or closing any dedicated toast window

## Verified on disk

- rebuild completed successfully on March 9, 2026 after stopping the running app
- built bundle contains `NotifyIcon` and `ShowBalloonTip`
- latest log contains:
  - `status.received`
  - `balloon.spawned`

## Remaining validation

The remaining work is runtime UX validation, not another `BrowserWindow` toast rewrite.

Specifically:

1. Launch the rebuilt app.
2. Trigger a real prompt replace from the picker or a prompt hotkey.
3. Confirm the native balloon appears and dismisses normally.
4. Confirm no minimized, ghost, or black feedback window appears.

## Notes

- If `bun run build` fails with `EPERM: operation not permitted, rmdir`, the usual cause is the running Electrobun/Bun app still holding files under `build/dev-win-x64`.
- In that case, stop the running `electrobun.exe` and bundled `bun.exe`, then rebuild.
