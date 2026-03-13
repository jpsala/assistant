import { dlopen, FFIType } from "bun:ffi";
import { createLogger } from "./logger";
import type {
  ChordBindingRegistration,
  KeyboardBackend,
  KeyEvent,
  PrefixRegistration,
} from "./keyboard-backend";

type PrefixBinding = {
  id: string;
  accelerator: string;
  parts: PrefixParts;
  handler: () => void;
};

type PrefixParts = {
  key: string;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
};

type ChordBinding = {
  id: string;
  prefix: PrefixParts;
  suffixVk: number;
};

type WorkerMessage =
  | { type: "thread-ready"; threadId: number }
  | { type: "started"; threadId: number }
  | { type: "stopped"; threadId: number }
  | { type: "error"; error: string }
  | {
      type: "prefix-triggered";
      event: KeyEvent & { sourceHwnd: number | null };
    }
  | {
      type: "key-event";
      event: KeyEvent & { injected?: boolean; consumed?: boolean; sourceHwnd?: number | null };
    };

const WM_QUIT = 0x0012;
const WM_APP = 0x8000;
const WM_CHORD_CLEAR = WM_APP + 1;
const WM_CHORD_ADD = WM_APP + 2;
const WM_CHORD_TIMEOUT = WM_APP + 3;
const CHORD_TIMEOUT_MS = 900;

const { symbols: user32 } = dlopen("user32.dll", {
  PostThreadMessageW: { returns: FFIType.bool, args: [FFIType.u32, FFIType.u32, FFIType.usize, FFIType.isize] },
});

const MODIFIER_ALIASES = new Map<string, keyof Omit<PrefixParts, "key">>([
  ["alt", "alt"],
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["shift", "shift"],
  ["meta", "meta"],
  ["win", "meta"],
  ["cmd", "meta"],
  ["super", "meta"],
]);

function modifierMask(parts: PrefixParts): number {
  let mask = 0;
  if (parts.alt) mask |= 1;
  if (parts.ctrl) mask |= 2;
  if (parts.shift) mask |= 4;
  if (parts.meta) mask |= 8;
  return mask;
}

function keyTokenToVk(key: string): number {
  const normalized = normalizeKeyToken(key);
  if (/^[A-Z]$/.test(normalized)) return normalized.charCodeAt(0);
  if (/^[0-9]$/.test(normalized)) return normalized.charCodeAt(0);

  switch (normalized) {
    case "Esc":
      return 0x1b;
    case "Space":
      return 0x20;
    case "Enter":
      return 0x0d;
    case "Tab":
      return 0x09;
    case "Backspace":
      return 0x08;
    case "Delete":
      return 0x2e;
    case "Left":
      return 0x25;
    case "Up":
      return 0x26;
    case "Right":
      return 0x27;
    case "Down":
      return 0x28;
    default:
      throw new Error(`Unsupported key token for Windows VK mapping: ${normalized}`);
  }
}

export function normalizeKeyToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();

  switch (trimmed.toLowerCase()) {
    case "esc":
    case "escape":
      return "Esc";
    case "space":
      return "Space";
    case "enter":
      return "Enter";
    case "tab":
      return "Tab";
    default:
      return trimmed;
  }
}

export function parseAccelerator(accelerator: string): PrefixParts {
  const parts: PrefixParts = {
    key: "",
    alt: false,
    ctrl: false,
    shift: false,
    meta: false,
  };

  for (const token of accelerator.split("+").map((part) => part.trim()).filter(Boolean)) {
    const modifier = MODIFIER_ALIASES.get(token.toLowerCase());
    if (modifier) {
      parts[modifier] = true;
      continue;
    }
    parts.key = normalizeKeyToken(token);
  }

  if (!parts.key) {
    throw new Error(`Accelerator "${accelerator}" is missing a non-modifier key`);
  }

  return parts;
}

export function matchesPrefix(parts: PrefixParts, event: KeyEvent): boolean {
  if (event.type !== "down" || event.repeat) return false;
  return (
    normalizeKeyToken(event.key) === parts.key &&
    event.alt === parts.alt &&
    event.ctrl === parts.ctrl &&
    event.shift === parts.shift &&
    event.meta === parts.meta
  );
}

export class WindowsKeyboardBackend implements KeyboardBackend {
  private readonly log = createLogger("windows-keyboard-backend");
  private readonly listeners = new Set<(event: KeyEvent) => void>();
  private readonly prefixes = new Map<string, PrefixBinding>();
  private readonly chordBindings = new Map<string, ChordBinding>();
  private worker: Worker | null = null;
  private workerThreadId: number | null = null;
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;

    const worker = new Worker(new URL("./windows-keyboard-hook-worker.ts", import.meta.url).href, {
      type: "module",
    });

    this.worker = worker;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Windows keyboard backend worker did not start in time"));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };

      const onError = (event: ErrorEvent) => {
        cleanup();
        this.log.error("backend.hook_error", { error: event.error ?? event.message });
        reject(event.error ?? new Error(event.message));
      };

      const onMessage = (message: MessageEvent<WorkerMessage>) => {
        const data = message.data;
        if (data.type === "thread-ready") {
          this.workerThreadId = data.threadId;
          return;
        }
        if (data.type === "started") {
          cleanup();
          this.workerThreadId = data.threadId;
          this.started = true;
          this.syncBindingsWorker();
          this.log.info("backend.hook_started", { threadId: data.threadId });
          resolve();
          return;
        }
        if (data.type === "error") {
          cleanup();
          this.log.error("backend.hook_error", { error: data.error });
          reject(new Error(data.error));
        }
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
    });

    worker.addEventListener("message", this.handleWorkerMessage);
    worker.addEventListener("error", this.handleWorkerError);
  }

  async stop(): Promise<void> {
    if (!this.worker || !this.started) return;
    const worker = this.worker;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        worker.terminate();
        resolve();
      }, 3000);

      const cleanup = () => {
        clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
      };

      const onMessage = (message: MessageEvent<WorkerMessage>) => {
        if (message.data.type === "stopped") {
          cleanup();
          resolve();
        }
      };

      if (this.workerThreadId !== null) {
        user32.PostThreadMessageW(this.workerThreadId, WM_QUIT, 0, 0);
      } else {
        worker.terminate();
        cleanup();
        resolve();
        return;
      }
    });

    worker.removeEventListener("message", this.handleWorkerMessage);
    worker.removeEventListener("error", this.handleWorkerError);
    this.worker = null;
    this.workerThreadId = null;
    this.started = false;
    this.log.info("backend.hook_stopped");
  }

  async registerPrefix(reg: PrefixRegistration, handler: () => void): Promise<void> {
    this.prefixes.set(reg.id, {
      id: reg.id,
      accelerator: reg.accelerator,
      parts: parseAccelerator(reg.accelerator),
      handler,
    });
  }

  async unregisterPrefix(id: string): Promise<void> {
    this.prefixes.delete(id);
  }

  async registerChordBinding(reg: ChordBindingRegistration): Promise<void> {
    const prefix = parseAccelerator(reg.prefix);
    this.chordBindings.set(reg.id, {
      id: reg.id,
      prefix,
      suffixVk: keyTokenToVk(reg.suffix),
    });
    this.syncBindingsWorker();
  }

  async unregisterChordBinding(id: string): Promise<void> {
    this.chordBindings.delete(id);
    this.syncBindingsWorker();
  }

  onKeyEvent(handler: (event: KeyEvent) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.log.error("backend.hook_error", { error: event.error ?? event.message });
  };

  private readonly handleWorkerMessage = (message: MessageEvent<WorkerMessage>): void => {
    const data = message.data;
    if (data.type === "prefix-triggered") {
      this.log.debug("backend.prefix_triggered", { ...data.event });
      for (const prefix of this.prefixes.values()) {
        if (matchesPrefix(prefix.parts, data.event)) {
          prefix.handler();
        }
      }
      return;
    }

    if (data.type === "key-event") {
      const { injected, consumed, sourceHwnd, ...event } = data.event;
      this.log.debug("backend.key_event", {
        ...event,
        injected,
        consumed,
        sourceHwnd,
      });
      for (const listener of this.listeners) {
        listener(event);
      }
      return;
    }

    if (data.type === "error") {
      this.log.error("backend.hook_error", { error: data.error });
    }
  };

  private syncBindingsWorker(): void {
    if (this.workerThreadId === null) return;

    user32.PostThreadMessageW(this.workerThreadId, WM_CHORD_TIMEOUT, CHORD_TIMEOUT_MS, 0);
    user32.PostThreadMessageW(this.workerThreadId, WM_CHORD_CLEAR, 0, 0);

    for (const binding of this.chordBindings.values()) {
      const packedPrefix =
        (keyTokenToVk(binding.prefix.key) & 0xff) |
        ((modifierMask(binding.prefix) & 0xff) << 8);
      user32.PostThreadMessageW(this.workerThreadId, WM_CHORD_ADD, packedPrefix, binding.suffixVk);
    }
  }
}
