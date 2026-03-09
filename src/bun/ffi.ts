/**
 * Windows FFI bindings — user32.dll + kernel32.dll + msvcrt.dll
 *
 * Public API:
 *   captureSelectedText()          → { text, hwnd, savedClipboard }
 *   pasteText(text, hwnd, saved)   → void
 *   getForegroundWindow()          → hwnd
 *   setForegroundWindow(hwnd)      → bool
 *   readClipboard()                → string | null
 *   writeClipboard(text)           → bool
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { createLogger } from "./logger";

const log = createLogger("ffi");

// ─── Constants ────────────────────────────────────────────────────────────────

const INPUT_SIZE = 40; // sizeof(INPUT) on 64-bit Windows — verified
const INPUT_TYPE_KEYBOARD = 1;
const INPUT_TYPE_MOUSE = 0;
const KEYEVENTF_KEYUP = 0x0002;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_ABSOLUTE = 0x8000;
const MOUSEEVENTF_MOVE = 0x0001;
const VK_SHIFT   = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU    = 0x12; // Alt
const VK_LWIN    = 0x5B;
const VK_RWIN    = 0x5C;
const VK_C = 0x43;
const VK_V = 0x56;
const CF_UNICODETEXT = 13;
const GMEM_MOVEABLE = 0x0002;

// ─── INPUT struct byte layout (64-bit) ───────────────────────────────────────
//   [0 -  3]  type        (u32) = 1 (KEYBOARD)
//   [4 -  7]  padding     (u32) = 0
//   [8 -  9]  wVk         (u16)
//  [10 - 11]  wScan       (u16) = 0
//  [12 - 15]  dwFlags     (u32) = 0 (down) | 0x0002 (up)
//  [16 - 19]  time        (u32) = 0
//  [20 - 23]  padding     (u32) = 0  ← aligns dwExtraInfo to 8 bytes
//  [24 - 31]  dwExtraInfo (u64) = 0
//  [32 - 39]  padding           = 0  ← fills union to sizeof(MOUSEINPUT)=32

// ─── DLL bindings ─────────────────────────────────────────────────────────────

const { symbols: u32 } = dlopen("user32.dll", {
  GetForegroundWindow: { returns: FFIType.ptr, args: [] },
  SetForegroundWindow: { returns: FFIType.bool, args: [FFIType.ptr] },
  BringWindowToTop: { returns: FFIType.bool, args: [FFIType.ptr] },
  SetFocus: { returns: FFIType.ptr, args: [FFIType.ptr] },
  SendInput: {
    returns: FFIType.u32,
    args: [FFIType.u32, FFIType.ptr, FFIType.i32],
  },
  OpenClipboard: { returns: FFIType.bool, args: [FFIType.ptr] },
  CloseClipboard: { returns: FFIType.bool, args: [] },
  EmptyClipboard: { returns: FFIType.bool, args: [] },
  GetClipboardData: { returns: FFIType.ptr, args: [FFIType.u32] },
  SetClipboardData: { returns: FFIType.ptr, args: [FFIType.u32, FFIType.ptr] },
  IsClipboardFormatAvailable: { returns: FFIType.bool, args: [FFIType.u32] },
  // Used to reliably transfer focus before SendInput (AttachThreadInput pattern)
  GetWindowThreadProcessId: { returns: FFIType.u32, args: [FFIType.ptr, FFIType.ptr] },
  AttachThreadInput: { returns: FFIType.bool, args: [FFIType.u32, FFIType.u32, FFIType.bool] },
  // Window search
  FindWindowW: { returns: FFIType.ptr, args: [FFIType.ptr, FFIType.ptr] },
  // FindWindowExW(parent, childAfter, className, windowName) — enumerate children
  FindWindowExW: { returns: FFIType.ptr, args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr] },
  // GetClassNameW(hwnd, buf, bufLen) — get window class name as UTF-16LE
  GetClassNameW: { returns: FFIType.i32, args: [FFIType.ptr, FFIType.ptr, FFIType.i32] },
  // GetWindowRect(hwnd, rect*) — returns rect as { left, top, right, bottom } in screen coords
  GetWindowRect: { returns: FFIType.bool, args: [FFIType.ptr, FFIType.ptr] },
  // GetSystemMetrics for screen dimensions
  GetSystemMetrics: { returns: FFIType.i32, args: [FFIType.i32] },
  // AllowSetForegroundWindow(dwProcessId) — ASFW_ANY = 0xFFFFFFFF allows any process
  AllowSetForegroundWindow: { returns: FFIType.bool, args: [FFIType.u32] },
});

const { symbols: k32 } = dlopen("kernel32.dll", {
  GlobalAlloc: { returns: FFIType.ptr, args: [FFIType.u32, FFIType.u32] },
  GlobalLock: { returns: FFIType.ptr, args: [FFIType.ptr] },
  GlobalUnlock: { returns: FFIType.bool, args: [FFIType.ptr] },
  GlobalSize: { returns: FFIType.u32, args: [FFIType.ptr] },
  GetCurrentThreadId: { returns: FFIType.u32, args: [] },
});

// memcpy to move data between local Buffers and native (GlobalAlloc) memory.
// Avoids toArrayBuffer which behaves inconsistently in Bun 1.2.
const { symbols: crt } = dlopen("msvcrt.dll", {
  memcpy: {
    returns: FFIType.ptr,
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
  },
});

// ─── Keyboard helpers ─────────────────────────────────────────────────────────

function buildKeyComboBuffer(vk1: number, vk2: number): Uint8Array {
  const buf = new Uint8Array(INPUT_SIZE * 4); // 4 INPUT structs
  const dv = new DataView(buf.buffer);

  const write = (idx: number, vk: number, flags: number) => {
    const o = idx * INPUT_SIZE;
    dv.setUint32(o + 0, INPUT_TYPE_KEYBOARD, true); // type
    dv.setUint16(o + 8, vk, true); // wVk
    dv.setUint32(o + 12, flags, true); // dwFlags
  };

  write(0, vk1, 0); // vk1 down
  write(1, vk2, 0); // vk2 down
  write(2, vk2, KEYEVENTF_KEYUP); // vk2 up
  write(3, vk1, KEYEVENTF_KEYUP); // vk1 up

  return buf;
}

function sendKeys(vk1: number, vk2: number): number {
  const buf = buildKeyComboBuffer(vk1, vk2);
  return u32.SendInput(4, ptr(buf), INPUT_SIZE) as number;
}

/**
 * Release all modifier keys that may still be logically "held" from the hotkey
 * that triggered this action. Without this, SendInput(Ctrl+C) after a Ctrl+Alt+F
 * hotkey sends Ctrl+Alt+C instead of Ctrl+C.
 */
function releaseModifiers(): void {
  const mods = [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN];
  const buf = new Uint8Array(INPUT_SIZE * mods.length);
  const dv = new DataView(buf.buffer);
  mods.forEach((vk, i) => {
    const o = i * INPUT_SIZE;
    dv.setUint32(o + 0, INPUT_TYPE_KEYBOARD, true);
    dv.setUint16(o + 8, vk, true);
    dv.setUint32(o + 12, KEYEVENTF_KEYUP, true);
  });
  u32.SendInput(mods.length, ptr(buf), INPUT_SIZE);
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

function openClipboardRetry(tries = 5): boolean {
  for (let i = 0; i < tries; i++) {
    if (u32.OpenClipboard(null)) return true;
    const t = Date.now() + 10;
    while (Date.now() < t) {} // busy-wait 10ms (clipboard is contested)
  }
  return false;
}

/** Encode text as UTF-16LE with null terminator */
function encodeUtf16LE(text: string): Uint8Array {
  const buf = new Uint8Array((text.length + 1) * 2);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < text.length; i++) {
    dv.setUint16(i * 2, text.charCodeAt(i), true);
  }
  // null terminator already zero from Uint8Array init
  return buf;
}

/** Decode UTF-16LE bytes, stripping null chars */
function decodeUtf16LE(bytes: Uint8Array): string {
  return new TextDecoder("utf-16le").decode(bytes).replace(/\0/g, "");
}

export function readClipboard(): string | null {
  if (!u32.IsClipboardFormatAvailable(CF_UNICODETEXT)) return null;
  if (!openClipboardRetry()) return null;

  try {
    const hMem = u32.GetClipboardData(CF_UNICODETEXT);
    if (!hMem) return null;

    const size = k32.GlobalSize(hMem) as number;
    if (!size) return null;

    const srcPtr = k32.GlobalLock(hMem);
    if (!srcPtr) return null;

    // Copy native memory → local Uint8Array via msvcrt memcpy
    const local = new Uint8Array(size);
    crt.memcpy(ptr(local), srcPtr, size);
    k32.GlobalUnlock(hMem);

    return decodeUtf16LE(local) || null;
  } finally {
    u32.CloseClipboard();
  }
}

export function writeClipboard(text: string): boolean {
  const encoded = encodeUtf16LE(text);

  if (!openClipboardRetry()) return false;

  try {
    const hMem = k32.GlobalAlloc(GMEM_MOVEABLE, encoded.byteLength);
    if (!hMem) return false;

    const destPtr = k32.GlobalLock(hMem);
    if (!destPtr) return false;

    // Copy local Uint8Array → native GlobalAlloc memory via msvcrt memcpy
    crt.memcpy(destPtr, ptr(encoded), encoded.byteLength);
    k32.GlobalUnlock(hMem);

    u32.EmptyClipboard();
    u32.SetClipboardData(CF_UNICODETEXT, hMem);
    return true;
  } finally {
    u32.CloseClipboard();
  }
}

function clearClipboard(): void {
  if (!openClipboardRetry()) return;
  u32.EmptyClipboard();
  u32.CloseClipboard();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type CaptureResult = {
  text: string;
  hwnd: unknown;
  savedClipboard: string | null;
};

export async function captureSelectedText(targetHwnd?: unknown): Promise<CaptureResult> {
  // Use provided hwnd (e.g. window that was focused before picker opened),
  // or fall back to current foreground window.
  const hwnd = targetHwnd ?? u32.GetForegroundWindow();
  const savedClipboard = readClipboard();

  clearClipboard();

  // Release modifier keys still held from the hotkey combo (e.g. Ctrl+Alt+F
  // leaves Ctrl and Alt logically "down" — without this, Ctrl+C becomes Ctrl+Alt+C)
  releaseModifiers();

  // AttachThreadInput pattern — the Windows-reliable way to send input to another
  // window. SetForegroundWindow alone is blocked by Windows Vista+ security when
  // the calling process didn't receive the last user input event.
  const currentThreadId = k32.GetCurrentThreadId() as number;
  const targetThreadId = u32.GetWindowThreadProcessId(hwnd, null) as number;
  const attached = targetThreadId && targetThreadId !== currentThreadId
    ? (u32.AttachThreadInput(currentThreadId, targetThreadId, true) as boolean)
    : false;

  if (hwnd) {
    u32.BringWindowToTop(hwnd);
    u32.SetForegroundWindow(hwnd);
  }
  await Bun.sleep(150);

  const sent = sendKeys(VK_CONTROL, VK_C);
  log.info("capture.keys_sent", { hwnd, targetThreadId, attached, sent });

  await Bun.sleep(400);

  if (attached) u32.AttachThreadInput(currentThreadId, targetThreadId, false);

  const text = readClipboard() ?? "";
  log.info("capture.clipboard_read", { hwnd, chars: text.length, preview: text.slice(0, 80) });

  if (savedClipboard !== null) writeClipboard(savedClipboard);

  return { text, hwnd, savedClipboard };
}

export async function pasteText(
  text: string,
  hwnd: unknown,
  savedClipboard: string | null
): Promise<void> {
  writeClipboard(text);
  await Bun.sleep(50);

  if (hwnd) u32.SetForegroundWindow(hwnd);
  await Bun.sleep(150);

  sendKeys(VK_CONTROL, VK_V);
  await Bun.sleep(300);

  if (savedClipboard !== null) writeClipboard(savedClipboard);
  else clearClipboard();
}

export function getForegroundWindow(): unknown {
  return u32.GetForegroundWindow();
}

export function setForegroundWindow(hwnd: unknown): boolean {
  return u32.SetForegroundWindow(hwnd) as boolean;
}

/**
 * Find a top-level window by exact title string.
 * Returns the HWND or null/0 if not found.
 */
export function findWindowByTitle(title: string): unknown {
  const buf = new Uint8Array((title.length + 1) * 2);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < title.length; i++) {
    dv.setUint16(i * 2, title.charCodeAt(i), true);
  }
  return u32.FindWindowW(null, ptr(buf));
}

/** Encode a JS string as a UTF-16LE null-terminated Uint8Array */
function utf16le(s: string): Uint8Array {
  const buf = new Uint8Array((s.length + 1) * 2);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return buf;
}

/**
 * Reliably transfer keyboard focus to a window using the AttachThreadInput
 * pattern — the only method that works under Windows Vista+ focus restrictions.
 *
 * Key: you must attach to the CURRENT FOREGROUND window's thread (not the
 * target's). That joins your thread to the foreground input queue, which is
 * the prerequisite for SetForegroundWindow to succeed.
 */
export function forceFocus(hwnd: unknown): void {
  if (!hwnd) return;
  const currentTid = k32.GetCurrentThreadId() as number;

  // Attach to the current foreground window's thread so SetForegroundWindow works.
  const fgHwnd = u32.GetForegroundWindow();
  const fgTid  = u32.GetWindowThreadProcessId(fgHwnd, null) as number;
  const attached = fgTid && fgTid !== currentTid
    ? (u32.AttachThreadInput(currentTid, fgTid, true) as boolean)
    : false;

  u32.BringWindowToTop(hwnd);
  u32.SetForegroundWindow(hwnd);

  if (attached) u32.AttachThreadInput(currentTid, fgTid, false);
}

/** Read a window's class name as a JS string. */
function getClassName(hwnd: unknown): string {
  const buf = new Uint8Array(512);
  const len = u32.GetClassNameW(hwnd, ptr(buf), 256) as number;
  if (!len) return "";
  return new TextDecoder("utf-16le").decode(buf.slice(0, len * 2));
}

/**
 * Log the full child window tree under a frame (for debugging focus issues).
 * Call this once to discover what class names WebView2 actually uses.
 */
export function logChildWindows(frameHwnd: unknown, depth = 0, maxDepth = 3): void {
  let child = u32.FindWindowExW(frameHwnd, null, null, null) as unknown;
  while (child) {
    const cls = getClassName(child);
    log.debug("window.child", { frameHwnd, depth, child, className: cls });
    if (depth < maxDepth) logChildWindows(child, depth + 1, maxDepth);
    child = u32.FindWindowExW(frameHwnd, child, null, null) as unknown;
  }
}

/**
 * Find the WebView2 input child window inside a frame and call SetFocus on it.
 * SetForegroundWindow only focuses the outer Win32 frame; we need SetFocus on
 * the embedded Chromium control to get keyboard input into the webview.
 *
 * Searches up to 4 levels deep for known WebView2 class names.
 * Returns true if a candidate was found and focused.
 */
export function focusWebView2Child(frameHwnd: unknown): boolean {
  if (!frameHwnd) return false;

  // Known class names used by WebView2/Chromium embedded controls.
  // Chrome_WidgetWin_1 is the typical Chromium input surface; others are fallbacks.
  const candidates = [
    "Chrome_WidgetWin_1",
    "Chrome_RenderWidgetHostHWND",
    "Intermediate D3D Window",
  ];

  function findInChildren(parent: unknown, depth: number): unknown {
    if (depth > 4) return null;
    let child = u32.FindWindowExW(parent, null, null, null) as unknown;
    while (child) {
      const cls = getClassName(child);
      if (candidates.some(c => cls.startsWith(c) || c.startsWith(cls.slice(0, 8)))) {
        return child;
      }
      const found = findInChildren(child, depth + 1);
      if (found) return found;
      child = u32.FindWindowExW(parent, child, null, null) as unknown;
    }
    return null;
  }

  const target = findInChildren(frameHwnd, 0);

  if (!target) {
    log.warn("webview_child.not_found", { frameHwnd });
    return false;
  }

  log.info("webview_child.found", { frameHwnd, target });

  // SetFocus requires same-thread or AttachThreadInput
  const currentTid = k32.GetCurrentThreadId() as number;
  const fgHwnd = u32.GetForegroundWindow();
  const fgTid  = u32.GetWindowThreadProcessId(fgHwnd, null) as number;
  const attached = fgTid && fgTid !== currentTid
    ? (u32.AttachThreadInput(currentTid, fgTid, true) as boolean)
    : false;

  u32.SetFocus(target);

  if (attached) u32.AttachThreadInput(currentTid, fgTid, false);
  return true;
}

// ─── Synthetic mouse click for focus (Option A) ────────────────────────────────

// SM_CXSCREEN = 0, SM_CYSCREEN = 1
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;

/**
 * Get the screen coordinates of a window.
 * Returns { left, top, right, bottom } in pixels.
 */
export function getWindowRect(hwnd: unknown): { left: number; top: number; right: number; bottom: number } | null {
  if (!hwnd) return null;
  // RECT is 4 x LONG (4 bytes each) = 16 bytes
  const rectBuf = new Int32Array(4);
  const ok = u32.GetWindowRect(hwnd, ptr(rectBuf)) as boolean;
  if (!ok) return null;
  return {
    left: rectBuf[0],
    top: rectBuf[1],
    right: rectBuf[2],
    bottom: rectBuf[3],
  };
}

/**
 * Perform a synthetic mouse click at screen coordinates (x, y).
 * Uses SendInput with MOUSEINPUT which Windows treats as real user input,
 * granting focus unconditionally.
 * 
 * @param x Screen X coordinate in pixels
 * @param y Screen Y coordinate in pixels
 */
function sendMouseClick(x: number, y: number): void {
  // Get screen dimensions for absolute coordinate normalization
  const screenWidth = u32.GetSystemMetrics(SM_CXSCREEN) as number;
  const screenHeight = u32.GetSystemMetrics(SM_CYSCREEN) as number;
  
  // Convert to absolute coordinates (0-65535 range)
  const absX = Math.round((x / screenWidth) * 65535);
  const absY = Math.round((y / screenHeight) * 65535);
  
  // MOUSEINPUT struct (40 bytes on 64-bit):
  // [0-3]  dx (LONG) - for absolute, this is the normalized X
  // [4-7]  dy (LONG) - for absolute, this is the normalized Y
  // [8-11] mouseData (DWORD) - 0 for normal click
  // [12-15] dwFlags (DWORD) - MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTDOWN/UP
  // [16-19] time (DWORD) - 0
  // [20-23] dwExtraInfo (ULONG_PTR) - 0
  // [24-31] padding (8 bytes to align to largest union member)
  // [32-39] padding
  
  // Build two INPUT structs: one for mouse down, one for mouse up
  const buf = new Uint8Array(INPUT_SIZE * 2);
  const dv = new DataView(buf.buffer);
  
  // MOUSEINPUT layout (same as INPUT when type=0)
  // First INPUT: move + left down
  dv.setUint32(0, INPUT_TYPE_MOUSE, true);        // type = MOUSE
  dv.setInt32(4, absX, true);                     // dx (absolute X)
  dv.setInt32(8, absY, true);                     // dy (absolute Y)
  dv.setUint32(12, 0, true);                      // mouseData
  dv.setUint32(16, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTDOWN, true); // dwFlags
  dv.setUint32(20, 0, true);                      // time
  // dwExtraInfo at offset 24 is already 0
  
  // Second INPUT: left up
  dv.setUint32(INPUT_SIZE, INPUT_TYPE_MOUSE, true);
  dv.setInt32(INPUT_SIZE + 4, absX, true);
  dv.setInt32(INPUT_SIZE + 8, absY, true);
  dv.setUint32(INPUT_SIZE + 12, 0, true);
  dv.setUint32(INPUT_SIZE + 16, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTUP, true);
  dv.setUint32(INPUT_SIZE + 20, 0, true);
  
  u32.SendInput(2, ptr(buf), INPUT_SIZE);
}

/**
 * Click at the center of a window to give it keyboard focus.
 * This is the most reliable way to focus WebView2 content on Windows.
 * 
 * @param hwnd The window to click
 * @param offsetY Optional Y offset from center (default: 40px for titlebar + search box)
 */
export function clickToFocus(hwnd: unknown, offsetY = 50): boolean {
  const rect = getWindowRect(hwnd);
  if (!rect) {
    log.warn("click_to_focus.rect_failed", { hwnd });
    return false;
  }
  
  // Calculate center of window, with Y offset for the search box
  const centerX = Math.round((rect.left + rect.right) / 2);
  const centerY = rect.top + offsetY; // Near top where search box is
  
  log.info("click_to_focus.clicking", { hwnd, centerX, centerY, offsetY });
  
  sendMouseClick(centerX, centerY);
  return true;
}

// ─── AllowSetForegroundWindow for BUG 2 ───────────────────────────────────────

const ASFW_ANY = 0xFFFFFFFF;

/**
 * Allow any process to call SetForegroundWindow.
 * This must be called by the foreground process before another process
 * tries to steal focus. Call this proactively at startup or before
 * showing the picker.
 */
export function allowSetForegroundWindow(): boolean {
  const result = u32.AllowSetForegroundWindow(ASFW_ANY) as boolean;
  log.info("allow_set_foreground_window", { result });
  return result;
}
