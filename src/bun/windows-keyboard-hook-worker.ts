import { dlopen, FFIType, JSCallback, ptr, toArrayBuffer } from "bun:ffi";

const WH_KEYBOARD_LL = 13;
const HC_ACTION = 0;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;
const WM_QUIT = 0x0012;

const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_LWIN = 0x5b;
const VK_RWIN = 0x5c;

const LLKHF_INJECTED = 0x10;

const { symbols: user32 } = dlopen("user32.dll", {
  SetWindowsHookExW: { returns: FFIType.ptr, args: [FFIType.i32, FFIType.function, FFIType.ptr, FFIType.u32] },
  UnhookWindowsHookEx: { returns: FFIType.bool, args: [FFIType.ptr] },
  CallNextHookEx: { returns: FFIType.isize, args: [FFIType.ptr, FFIType.i32, FFIType.usize, FFIType.ptr] },
  GetMessageW: { returns: FFIType.i32, args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32] },
  TranslateMessage: { returns: FFIType.bool, args: [FFIType.ptr] },
  DispatchMessageW: { returns: FFIType.isize, args: [FFIType.ptr] },
  GetAsyncKeyState: { returns: FFIType.i16, args: [FFIType.i32] },
  PostThreadMessageW: { returns: FFIType.bool, args: [FFIType.u32, FFIType.u32, FFIType.usize, FFIType.isize] },
});

const { symbols: kernel32 } = dlopen("kernel32.dll", {
  GetCurrentThreadId: { returns: FFIType.u32, args: [] },
});

function isPressed(vk: number): boolean {
  return ((user32.GetAsyncKeyState(vk) as number) & 0x8000) !== 0;
}

function vkToKey(vk: number): string {
  if (vk >= 0x41 && vk <= 0x5a) return String.fromCharCode(vk);
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk);

  switch (vk) {
    case 0x1b:
      return "Esc";
    case 0x20:
      return "Space";
    case 0x0d:
      return "Enter";
    case 0x09:
      return "Tab";
    case 0x08:
      return "Backspace";
    case 0x2e:
      return "Delete";
    case 0x25:
      return "Left";
    case 0x26:
      return "Up";
    case 0x27:
      return "Right";
    case 0x28:
      return "Down";
    case VK_SHIFT:
      return "Shift";
    case VK_CONTROL:
      return "Ctrl";
    case VK_MENU:
      return "Alt";
    case VK_LWIN:
    case VK_RWIN:
      return "Meta";
    default:
      return `VK_${vk.toString(16).toUpperCase()}`;
  }
}

const pressed = new Set<number>();

const hookCallback = new JSCallback(
  (code, wParam, lParam) => {
    if (code === HC_ACTION) {
      const msg = Number(wParam);
      if (msg === WM_KEYDOWN || msg === WM_SYSKEYDOWN || msg === WM_KEYUP || msg === WM_SYSKEYUP) {
        const native = new Uint8Array(toArrayBuffer(lParam, 0, 24));
        const dv = new DataView(native.buffer);
        const vkCode = dv.getUint32(0, true);
        const flags = dv.getUint32(8, true);
        const timestamp = dv.getUint32(12, true);
        const type = msg === WM_KEYUP || msg === WM_SYSKEYUP ? "up" : "down";
        const repeat = type === "down" && pressed.has(vkCode);

        if (type === "down") pressed.add(vkCode);
        else pressed.delete(vkCode);

        postMessage({
          type: "key-event",
          event: {
            type,
            key: vkToKey(vkCode),
            alt: isPressed(VK_MENU),
            ctrl: isPressed(VK_CONTROL),
            shift: isPressed(VK_SHIFT),
            meta: isPressed(VK_LWIN) || isPressed(VK_RWIN),
            repeat,
            timestamp,
            injected: (flags & LLKHF_INJECTED) !== 0,
          },
        });
      }
    }

    return user32.CallNextHookEx(null, code, wParam, lParam);
  },
  {
    returns: FFIType.isize,
    args: [FFIType.i32, FFIType.usize, FFIType.ptr],
    threadsafe: true,
  },
);

const messageBuffer = new Uint8Array(48);
const threadId = kernel32.GetCurrentThreadId() as number;

postMessage({ type: "thread-ready", threadId });

const hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, hookCallback.ptr, null, 0);

if (!hook) {
  postMessage({ type: "error", error: "SetWindowsHookExW returned null" });
} else {
  postMessage({ type: "started", threadId });
  while (true) {
    const result = user32.GetMessageW(ptr(messageBuffer), null, 0, 0) as number;
    if (result <= 0) break;
    user32.TranslateMessage(ptr(messageBuffer));
    user32.DispatchMessageW(ptr(messageBuffer));
  }
  user32.UnhookWindowsHookEx(hook);
  postMessage({ type: "stopped", threadId });
}

hookCallback.close();
