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

// ─── Constants ────────────────────────────────────────────────────────────────

const INPUT_SIZE = 40; // sizeof(INPUT) on 64-bit Windows — verified
const INPUT_TYPE_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const VK_CONTROL = 0x11;
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
});

const { symbols: k32 } = dlopen("kernel32.dll", {
  GlobalAlloc: { returns: FFIType.ptr, args: [FFIType.u32, FFIType.u32] },
  GlobalLock: { returns: FFIType.ptr, args: [FFIType.ptr] },
  GlobalUnlock: { returns: FFIType.bool, args: [FFIType.ptr] },
  GlobalSize: { returns: FFIType.u32, args: [FFIType.ptr] },
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

export async function captureSelectedText(): Promise<CaptureResult> {
  const hwnd = u32.GetForegroundWindow();
  const savedClipboard = readClipboard();

  clearClipboard();
  sendKeys(VK_CONTROL, VK_C);

  await Bun.sleep(300);

  const text = readClipboard() ?? "";

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
