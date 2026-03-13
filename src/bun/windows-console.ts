import { dlopen, FFIType } from "bun:ffi";

const SW_HIDE = 0;

export function hideWindowsConsole(): void {
  if (process.platform !== "win32") return;

  try {
    const { symbols: kernel32 } = dlopen("kernel32.dll", {
      GetConsoleWindow: { returns: FFIType.ptr, args: [] },
      FreeConsole: { returns: FFIType.bool, args: [] },
    });
    const { symbols: user32 } = dlopen("user32.dll", {
      ShowWindow: { returns: FFIType.bool, args: [FFIType.ptr, FFIType.i32] },
    });

    const consoleWindow = kernel32.GetConsoleWindow();
    if (!consoleWindow) return;

    user32.ShowWindow(consoleWindow, SW_HIDE);
    kernel32.FreeConsole();
  } catch {
    // If Windows console APIs are unavailable, keep booting normally.
  }
}
