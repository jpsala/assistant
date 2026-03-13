/**
 * Hotkey manager — wraps Electrobun GlobalShortcut with:
 *   - AHK-style format conversion  (!+w → Alt+Shift+W)
 *   - Chord hotkeys  (Alt+Shift+Q → Alt+R)
 *   - Named system hotkeys (promptChat, picker, etc.)
 *   - Dynamic per-prompt hotkey registration/unregistration
 */

import { GlobalShortcut } from "electrobun/bun";
import { captureSelectedText, getForegroundWindow, releaseModifiers, type CaptureResult } from "./ffi";
import { createLogger } from "./logger";
import { createChordService } from "./chord-service";
import type { PendingChordState } from "./chord-types";
import { WindowsKeyboardBackend } from "./windows-keyboard-backend";

// ─── Format conversion ────────────────────────────────────────────────────────

/**
 * Convert AHK-style modifier prefix to Electrobun accelerator.
 *   !+w  → Alt+Shift+W
 *   ^+f  → Ctrl+Shift+F
 *   !+q  → Alt+Shift+Q
 *
 * Also accepts friendly format already (Alt+Shift+W) — returned as-is.
 */
const MODIFIER_MAP = new Map<string, string>([
  ["^", "Ctrl"],
  ["!", "Alt"],
  ["+", "Shift"],
  ["#", "Meta"],
]);

const FRIENDLY_MODIFIER_ALIASES = new Map<string, string>([
  ["ctrl", "Ctrl"],
  ["control", "Ctrl"],
  ["alt", "Alt"],
  ["shift", "Shift"],
  ["meta", "Meta"],
  ["win", "Meta"],
  ["cmd", "Meta"],
  ["super", "Meta"],
]);

const KEY_ALIASES = new Map<string, string>([
  ["esc", "Esc"],
  ["escape", "Esc"],
  ["space", "Space"],
  ["enter", "Enter"],
  ["tab", "Tab"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["del", "Delete"],
  ["insert", "Insert"],
  ["ins", "Insert"],
  ["up", "Up"],
  ["down", "Down"],
  ["left", "Left"],
  ["right", "Right"],
  ["home", "Home"],
  ["end", "End"],
  ["pgup", "PgUp"],
  ["pageup", "PgUp"],
  ["pgdn", "PgDn"],
  ["pagedown", "PgDn"],
]);

export type HotkeyValidationResult = {
  ok: boolean;
  kind: "single" | "chord";
  normalized: string;
  errors: string[];
  prefix?: string;
  suffix?: string;
};

export type HotkeyRegistrationResult = {
  ok: boolean;
  reason?: "invalid" | "already_registered";
  owner?: string;
  normalized: string;
  kind: "single" | "chord";
  errors: string[];
};

type RegisteredHotkeyInfo = {
  name: string;
  spec: string;
  normalized: string;
  kind: "single" | "chord";
  accelerators: string[];
};

type ChordHintShowFn = (prefix: string, entries: { key: string; label: string }[]) => void;

const log = createLogger("hotkeys");

let hintShow: ChordHintShowFn = () => {};
let hintHide: () => void = () => {};

export function setChordHintCallbacks(show: ChordHintShowFn, hide: () => void): void {
  hintShow = show;
  hintHide = hide;
}

function normalizeFriendlyToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  const modifier = FRIENDLY_MODIFIER_ALIASES.get(trimmed.toLowerCase());
  if (modifier) return modifier;
  const keyAlias = KEY_ALIASES.get(trimmed.toLowerCase());
  if (keyAlias) return keyAlias;
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed;
}

function normalizeSingleSpec(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return "";

  const isAhkStyle =
    !trimmed.includes("->") &&
    !trimmed.includes(",") &&
    /^[!^+#]*[A-Za-z0-9]+$/i.test(trimmed);

  if (isAhkStyle) {
    const modifiers: string[] = [];
    let key = "";
    for (const ch of trimmed) {
      const modifier = MODIFIER_MAP.get(ch);
      if (modifier) {
        if (!modifiers.includes(modifier)) modifiers.push(modifier);
        continue;
      }
      key += ch;
    }
    const normalizedKey = normalizeFriendlyToken(key);
    return [...modifiers, normalizedKey].filter(Boolean).join("+");
  }

  return trimmed
    .split("+")
    .map((token) => normalizeFriendlyToken(token))
    .filter(Boolean)
    .join("+");
}

function validateSingleSpec(spec: string, role: "single" | "chord-prefix" | "chord-suffix"): string[] {
  const errors: string[] = [];
  const normalized = normalizeSingleSpec(spec);
  if (!normalized) {
    errors.push("Hotkey is empty.");
    return errors;
  }

  const tokens = normalized.split("+").filter(Boolean);
  const modifiers = tokens.filter((token) => FRIENDLY_MODIFIER_ALIASES.has(token.toLowerCase()));
  const keys = tokens.filter((token) => !FRIENDLY_MODIFIER_ALIASES.has(token.toLowerCase()));

  if (keys.length === 0) {
    errors.push("Hotkey needs a non-modifier key.");
  }
  if (keys.length > 1) {
    errors.push("Only one non-modifier key is supported per step.");
  }
  if (role !== "chord-suffix" && modifiers.length === 0) {
    errors.push("Global hotkeys should include at least one modifier.");
  }
  return errors;
}

function findOwnerForAccelerator(accelerator: string, excludeName?: string): string | undefined {
  for (const [name, info] of registeredInfo) {
    if (name !== excludeName && info.accelerators.includes(accelerator)) return name;
  }
  return undefined;
}

export function ahkToAccelerator(spec: string): string {
  return normalizeSingleSpec(spec);
}

export function formatHotkeyForDisplay(spec: string): string {
  const chord = parseChord(spec);
  if (chord) {
    return `${chord.prefix} -> ${chord.suffix}`;
  }
  return ahkToAccelerator(spec);
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
const registeredInfo = new Map<string, RegisteredHotkeyInfo>();

type ChordAction = {
  cb: HotkeyCallback;
  label: string;
  prefix: string;
  suffix: string;
};

// chord prefix → { suffix → callback, timers }
type ChordState = {
  actions: Map<string, ChordAction>;
  timer: Timer | null;
  hintTimer: Timer | null;
  sourceHwnd: unknown;
};
const chordPrefixes = new Map<string, ChordState>();
const chordActionsByName = new Map<string, ChordAction>();
const chordPrefixRefs = new Map<string, Set<string>>();

const CHORD_TIMEOUT_MS = 900;
const CHORD_HINT_DELAY_MS = 400;

let chordHintTimer: Timer | null = null;
let visibleHintSessionId: number | null = null;
let chordBackendReady = false;

const chordBackend = process.platform === "win32" ? new WindowsKeyboardBackend() : null;
const chordService = createChordService({
  timeoutMs: CHORD_TIMEOUT_MS,
  onStateChange: (pending) => syncChordHint(pending),
});

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

const CHORD_HINT_TIMEOUT_MS = 5000;

function clearChordHintState(): void {
  if (chordHintTimer !== null) {
    clearTimeout(chordHintTimer);
    chordHintTimer = null;
  }
  if (visibleHintSessionId !== null) {
    hintHide();
    visibleHintSessionId = null;
  }
}

function syncChordHint(pending: PendingChordState<unknown> | null): void {
  if (!pending) {
    clearChordHintState();
    return;
  }

  if (visibleHintSessionId === pending.sessionId) {
    hintShow(
      pending.prefix,
      pending.entries.map((entry) => ({ key: entry.suffix, label: entry.label })),
    );
    return;
  }

  if (chordHintTimer !== null) {
    clearTimeout(chordHintTimer);
    chordHintTimer = null;
  }
  hintHide();
  visibleHintSessionId = null;

  chordHintTimer = setTimeout(() => {
    chordHintTimer = null;
    const latestPending = chordService.getPendingState();
    if (!latestPending || latestPending.sessionId !== pending.sessionId) return;
    visibleHintSessionId = latestPending.sessionId;
    hintShow(
      latestPending.prefix,
      latestPending.entries.map((entry) => ({ key: entry.suffix, label: entry.label })),
    );
  }, CHORD_HINT_DELAY_MS);
}

function hasChordBackend(): boolean {
  return chordBackendReady && chordBackend !== null;
}

async function invokeChordAction(actionId: string, prefix: string, suffix: string, sourceHwnd: unknown): Promise<void> {
  const action = chordActionsByName.get(actionId);
  if (!action) {
    log.warn("chord.action_missing", { actionId, prefix, suffix });
    return;
  }

  let preCaptured: CaptureResult | null = null;
  try {
    preCaptured = await captureSelectedText(sourceHwnd);
  } catch {
    preCaptured = null;
  }

  await action.cb(preCaptured ? { preCaptured } : undefined);
}

function handleChordKeyEvent(event: import("./keyboard-backend").KeyEvent): void {
  const resolution = chordService.handleKeyEvent(event);
  if (resolution.kind === "matched") {
    void invokeChordAction(
      resolution.match.actionId,
      resolution.match.prefix,
      resolution.match.suffix,
      resolution.pending.sourceHwnd,
    ).catch((error) => {
      log.error("chord.action_failed", {
        prefix: resolution.match.prefix,
        suffix: resolution.match.suffix,
        actionId: resolution.match.actionId,
        error,
      });
    });
  }
}

async function registerChordPrefixWithBackend(prefix: string): Promise<void> {
  if (!chordBackend) return;
  await chordBackend.registerPrefix({ id: prefix, accelerator: prefix }, () => {
    releaseModifiers();
    chordService.beginPrefix(prefix, getForegroundWindow());
  });
}

function clearChordActivation(state: ChordState): void {
  for (const suf of state.actions.keys()) {
    GlobalShortcut.unregister(suf);
  }
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.hintTimer !== null) {
    clearTimeout(state.hintTimer);
    state.hintTimer = null;
  }
  hintHide();
  state.sourceHwnd = null;
}

function registerChord(
  name: string,
  prefix: string,
  suffix: string,
  cb: HotkeyCallback,
  label: string
): boolean {
  if (hasChordBackend()) {
    const refs = chordPrefixRefs.get(prefix);
    if (!refs) {
      void registerChordPrefixWithBackend(prefix).catch((error) => {
        log.error("chord.prefix_register_failed", { prefix, error });
      });
      chordPrefixRefs.set(prefix, new Set([name]));
    } else {
      refs.add(name);
    }

    const action: ChordAction = {
      cb,
      label,
      prefix,
      suffix,
    };
    chordActionsByName.set(name, action);
    void chordBackend.registerChordBinding({ id: name, prefix, suffix }).catch((error) => {
      log.error("chord.binding_register_failed", { name, prefix, suffix, error });
    });
    chordService.registerChord({ prefix, suffix, actionId: name, label });
    registered.set(name, [`__chord__${prefix}::${suffix}`]);
    return true;
  }

  // Ensure prefix is registered
  if (!chordPrefixes.has(prefix)) {
    const state: ChordState = { actions: new Map(), timer: null, hintTimer: null, sourceHwnd: null };
    chordPrefixes.set(prefix, state);

    const ok = _register(prefix, () => {
      releaseModifiers();
      const s = chordPrefixes.get(prefix)!;
      s.sourceHwnd = getForegroundWindow();

      if (s.timer !== null) {
        clearTimeout(s.timer);
        s.timer = null;
      }
      if (s.hintTimer !== null) {
        clearTimeout(s.hintTimer);
        s.hintTimer = null;
      }

      // Register all suffix keys temporarily
      for (const [suf, { cb: action }] of s.actions) {
        GlobalShortcut.register(suf, async () => {
          // One-shot chord: clear every temporary suffix, not just the one pressed.
          const sourceHwnd = s.sourceHwnd;
          clearChordActivation(s);
          let preCaptured: CaptureResult | null = null;
          try {
            preCaptured = await captureSelectedText(sourceHwnd);
          } catch {
            preCaptured = null;
          }
          await action(preCaptured ? { preCaptured } : undefined);
        });
      }

      s.hintTimer = setTimeout(() => {
        s.hintTimer = null;
        const entries = Array.from(s.actions.entries()).map(([key, action]) => ({
          key,
          label: action.label,
        }));
        hintShow(prefix, entries);
        if (s.timer !== null) {
          clearTimeout(s.timer);
          s.timer = setTimeout(() => clearChordActivation(s), CHORD_HINT_TIMEOUT_MS);
        }
      }, CHORD_HINT_DELAY_MS);

      // Timeout: unregister suffix keys
      s.timer = setTimeout(() => clearChordActivation(s), CHORD_TIMEOUT_MS);
    });

    if (!ok) return false;
  }

  const state = chordPrefixes.get(prefix)!;
  state.actions.set(suffix, { cb, label, prefix, suffix });
  chordActionsByName.set(name, { cb, label, prefix, suffix });

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
  cb: HotkeyCallback,
  label?: string
): boolean {
  return registerHotkeyDetailed(name, spec, cb, label).ok;
}

export function validateHotkeySpec(spec: string): HotkeyValidationResult {
  const chord = parseChord(spec);

  if (chord) {
    const errors = [
      ...validateSingleSpec(chord.prefix, "chord-prefix"),
      ...validateSingleSpec(chord.suffix, "chord-suffix"),
    ];
    return {
      ok: errors.length === 0,
      kind: "chord",
      normalized: `${chord.prefix} -> ${chord.suffix}`,
      prefix: chord.prefix,
      suffix: chord.suffix,
      errors,
    };
  }

  const normalized = ahkToAccelerator(spec);
  const errors = validateSingleSpec(normalized, "single");
  return {
    ok: errors.length === 0,
    kind: "single",
    normalized,
    errors,
  };
}

export function registerHotkeyDetailed(
  name: string,
  spec: string,
  cb: HotkeyCallback,
  label?: string
): HotkeyRegistrationResult {
  const validation = validateHotkeySpec(spec);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "invalid",
      normalized: validation.normalized,
      kind: validation.kind,
      errors: validation.errors,
    };
  }

  if (validation.kind === "chord") {
    const prefixOwner = findOwnerForAccelerator(validation.prefix!, name);
    const prefixOwnerInfo = prefixOwner ? registeredInfo.get(prefixOwner) : undefined;
    const sharedChordPrefix =
      prefixOwnerInfo?.kind === "chord" &&
      prefixOwnerInfo.accelerators[0] === validation.prefix!;

    if (prefixOwner && !sharedChordPrefix) {
      return {
        ok: false,
        reason: "already_registered",
        owner: prefixOwner,
        normalized: validation.normalized,
        kind: validation.kind,
        errors: [],
      };
    }

    const ok = registerChord(name, validation.prefix!, validation.suffix!, cb, label ?? name);
    if (ok) {
      registeredInfo.set(name, {
        name,
        spec,
        normalized: validation.normalized,
        kind: "chord",
        accelerators: [validation.prefix!, validation.suffix!],
      });
    }
    return {
      ok,
      reason: ok ? undefined : "already_registered",
      owner: ok ? undefined : findOwnerForAccelerator(validation.prefix!, name),
      normalized: validation.normalized,
      kind: validation.kind,
      errors: [],
    };
  }

  const acc = validation.normalized;
  const owner = findOwnerForAccelerator(acc, name);
  if (owner || GlobalShortcut.isRegistered(acc)) {
    return {
      ok: false,
      reason: "already_registered",
      owner,
      normalized: acc,
      kind: "single",
      errors: [],
    };
  }

  const ok = _register(acc, cb);
  if (ok) {
    registered.set(name, [acc]);
    registeredInfo.set(name, {
      name,
      spec,
      normalized: acc,
      kind: "single",
      accelerators: [acc],
    });
  }
  return {
    ok,
    reason: ok ? undefined : "already_registered",
    owner,
    normalized: acc,
    kind: "single",
    errors: [],
  };
}

/** Unregister a named hotkey (regular or chord) */
export function unregisterHotkey(name: string): void {
  const keys = registered.get(name);
  if (!keys) return;

  for (const key of keys) {
    if (key.startsWith("__chord__")) {
      const [, rest] = key.split("__chord__");
      const [prefix, suffix] = rest.split("::");
      chordActionsByName.delete(name);
      if (hasChordBackend()) {
        void chordBackend?.unregisterChordBinding(name);
        chordService.unregisterChord(name);
        const refs = chordPrefixRefs.get(prefix);
        refs?.delete(name);
        if (refs && refs.size === 0) {
          chordPrefixRefs.delete(prefix);
          void chordBackend?.unregisterPrefix(prefix);
        }
      } else {
        const state = chordPrefixes.get(prefix);
        if (state) {
          state.actions.delete(suffix);
          // If no more suffixes for this prefix, unregister the prefix too
          if (state.actions.size === 0) {
            _unregister(prefix);
            if (state.timer !== null) clearTimeout(state.timer);
            if (state.hintTimer !== null) clearTimeout(state.hintTimer);
            chordPrefixes.delete(prefix);
          }
        }
      }
    } else {
      _unregister(key);
    }
  }

  registered.delete(name);
  registeredInfo.delete(name);
}

/** Unregister all hotkeys */
export function unregisterAll(): void {
  const chordBindingNames = Array.from(registeredInfo.values())
    .filter((info) => info.kind === "chord")
    .map((info) => info.name);

  GlobalShortcut.unregisterAll();
  registered.clear();
  registeredInfo.clear();
  clearChordHintState();
  chordService.cancel("unregister_all");
  chordActionsByName.clear();
  for (const prefix of chordPrefixRefs.keys()) {
    void chordBackend?.unregisterPrefix(prefix);
  }
  for (const name of chordBindingNames) {
    void chordBackend?.unregisterChordBinding(name);
  }
  chordPrefixRefs.clear();
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
  cb: HotkeyCallback,
  label?: string
): boolean {
  return updateHotkeyDetailed(name, spec, cb, label).ok;
}

export function updateHotkeyDetailed(
  name: string,
  spec: string,
  cb: HotkeyCallback,
  label?: string
): HotkeyRegistrationResult {
  unregisterHotkey(name);
  return registerHotkeyDetailed(name, spec, cb, label);
}

export function getRegisteredHotkeys(): RegisteredHotkeyInfo[] {
  return Array.from(registeredInfo.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function initHotkeys(): Promise<void> {
  if (!chordBackend || chordBackendReady) return;
  try {
    await chordBackend.start();
    chordBackend.onKeyEvent(handleChordKeyEvent);
    chordBackendReady = true;
    log.info("chord.backend_ready");
  } catch (error) {
    chordBackendReady = false;
    log.warn("chord.backend_start_failed", { error });
  }
}

export async function shutdownHotkeys(): Promise<void> {
  unregisterAll();
  if (!chordBackend || !chordBackendReady) return;
  await chordBackend.stop();
  chordBackendReady = false;
  log.info("chord.backend_stopped");
}
