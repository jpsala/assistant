/**
 * Hotkey manager — wraps Electrobun GlobalShortcut with:
 *   - AHK-style format conversion  (!+w → Alt+Shift+W)
 *   - Chord hotkeys  (Alt+Shift+Q → Alt+R)
 *   - Named system hotkeys (promptChat, picker, etc.)
 *   - Dynamic per-prompt hotkey registration/unregistration
 */

import { GlobalShortcut } from "electrobun/bun";
import { captureSelectedText, getForegroundWindow, type CaptureResult } from "./ffi";

// ─── Format conversion ────────────────────────────────────────────────────────

/**
 * Convert AHK-style modifier prefix to Electrobun accelerator.
 *   !+w  → Alt+Shift+W
 *   ^+f  → Ctrl+Shift+F
 *   !+q  → Alt+Shift+Q
 *
 * Also accepts friendly format already (Alt+Shift+W) — returned as-is.
 */
export function ahkToAccelerator(spec: string): string {
  // Already friendly format (contains word "Alt", "Ctrl", "Shift", "Meta")
  if (/[A-Z][a-z]/.test(spec)) return spec;

  const parts: string[] = [];
  let i = 0;
  while (i < spec.length) {
    const ch = spec[i];
    switch (ch) {
      case "!":
        parts.push("Alt");
        i++;
        break;
      case "+":
        parts.push("Shift");
        i++;
        break;
      case "^":
        parts.push("Ctrl");
        i++;
        break;
      case "#":
        parts.push("Meta");
        i++;
        break;
      default:
        parts.push(ch.toUpperCase());
        i++;
        break;
    }
  }
  return parts.join("+");
}

/**
 * Chord spec:  "Alt+Shift+Q -> Alt+R"  or AHK  "!+q->!r"
 * Also supports AHK comma format:  "^!t,c"  (prefix ^!t, suffix c)
 */
function parseChord(
  spec: string
): { prefix: string; suffix: string } | null {
  // Arrow separator: "!+q -> !r" or "Alt+Q -> R"
  if (spec.includes("->")) {
    const [pre, suf] = spec.split("->").map((s) => ahkToAccelerator(s.trim()));
    return { prefix: pre, suffix: suf };
  }

  // AHK comma separator: "^!t,c" — split on the LAST comma
  // (only if the part after the comma looks like a key, not a modifier-only string)
  const commaIdx = spec.lastIndexOf(",");
  if (commaIdx > 0 && commaIdx < spec.length - 1) {
    const pre = spec.slice(0, commaIdx).trim();
    const suf = spec.slice(commaIdx + 1).trim();
    if (pre.length > 0 && suf.length > 0) {
      return { prefix: ahkToAccelerator(pre), suffix: ahkToAccelerator(suf) };
    }
  }

  return null;
}

// ─── State ────────────────────────────────────────────────────────────────────

export type HotkeyTriggerContext = {
  preCaptured?: CaptureResult;
};

type HotkeyCallback = (context?: HotkeyTriggerContext) => void | Promise<void>;

// name → accelerator (for cleanup)
const registered = new Map<string, string[]>();

// chord prefix → { suffix → callback, timeoutId }
type ChordState = {
  actions: Map<string, HotkeyCallback>;
  timer: Timer | null;
  preCapture: Promise<CaptureResult | null> | null;
};
const chordPrefixes = new Map<string, ChordState>();

// ─── Core registration ────────────────────────────────────────────────────────

function _register(accelerator: string, cb: HotkeyCallback): boolean {
  if (GlobalShortcut.isRegistered(accelerator)) return false;
  return GlobalShortcut.register(accelerator, cb);
}

function _unregister(accelerator: string): void {
  GlobalShortcut.unregister(accelerator);
}

// ─── Chord implementation ─────────────────────────────────────────────────────
//
// Chord hotkeys use two full key combos: prefix triggers a 900ms window
// during which the suffix is registered as a temporary global shortcut.
// Outside the window the suffix key is NOT intercepted.
//
// Note: suffix must be a full key combo (not a bare key) to avoid
// intercepting normal typing when not in chord mode.

const CHORD_TIMEOUT_MS = 900;

function registerChord(
  name: string,
  prefix: string,
  suffix: string,
  cb: HotkeyCallback
): boolean {
  // Ensure prefix is registered
  if (!chordPrefixes.has(prefix)) {
    const state: ChordState = { actions: new Map(), timer: null, preCapture: null };
    chordPrefixes.set(prefix, state);

    const ok = _register(prefix, () => {
      const s = chordPrefixes.get(prefix)!;
      const sourceHwnd = getForegroundWindow();
      s.preCapture = (async () => {
        try {
          return await captureSelectedText(sourceHwnd);
        } catch {
          return null;
        }
      })();

      // Cancel existing timer
      if (s.timer !== null) clearTimeout(s.timer);

      // Register all suffix keys temporarily
      for (const [suf, action] of s.actions) {
        GlobalShortcut.register(suf, async () => {
          // Unregister suffix immediately (one-shot)
          GlobalShortcut.unregister(suf);
          if (s.timer !== null) clearTimeout(s.timer);
          s.timer = null;
          const preCaptured = await s.preCapture;
          s.preCapture = null;
          await action(preCaptured ? { preCaptured } : undefined);
        });
      }

      // Timeout: unregister suffix keys
      s.timer = setTimeout(() => {
        for (const suf of s.actions.keys()) {
          GlobalShortcut.unregister(suf);
        }
        s.preCapture = null;
        s.timer = null;
      }, CHORD_TIMEOUT_MS);
    });

    if (!ok) return false;
  }

  const state = chordPrefixes.get(prefix)!;
  state.actions.set(suffix, cb);

  // Track for cleanup
  const existing = registered.get(name) ?? [];
  registered.set(name, [...existing, `__chord__${prefix}::${suffix}`]);

  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a hotkey by name. Supports:
 *   - Regular:  "Alt+Shift+W"  or AHK "!+w"
 *   - Chord:    "Alt+Shift+Q -> Alt+R"  or AHK "!+q->!r"
 */
export function registerHotkey(
  name: string,
  spec: string,
  cb: HotkeyCallback
): boolean {
  const chord = parseChord(spec);

  if (chord) {
    return registerChord(name, chord.prefix, chord.suffix, cb);
  }

  const acc = ahkToAccelerator(spec);
  const ok = _register(acc, cb);
  if (ok) registered.set(name, [acc]);
  return ok;
}

/** Unregister a named hotkey (regular or chord) */
export function unregisterHotkey(name: string): void {
  const keys = registered.get(name);
  if (!keys) return;

  for (const key of keys) {
    if (key.startsWith("__chord__")) {
      const [, rest] = key.split("__chord__");
      const [prefix, suffix] = rest.split("::");
      const state = chordPrefixes.get(prefix);
      if (state) {
        state.actions.delete(suffix);
        // If no more suffixes for this prefix, unregister the prefix too
        if (state.actions.size === 0) {
          _unregister(prefix);
          chordPrefixes.delete(prefix);
        }
      }
    } else {
      _unregister(key);
    }
  }

  registered.delete(name);
}

/** Unregister all hotkeys */
export function unregisterAll(): void {
  GlobalShortcut.unregisterAll();
  registered.clear();
  chordPrefixes.clear();
}

/** Check if a named hotkey is active */
export function isRegistered(name: string): boolean {
  return registered.has(name);
}

/** Re-register a hotkey with a new spec (used by settings) */
export function updateHotkey(
  name: string,
  spec: string,
  cb: HotkeyCallback
): boolean {
  unregisterHotkey(name);
  return registerHotkey(name, spec, cb);
}
