/**
 * Hotkey manager — wraps Electrobun GlobalShortcut with:
 *   - AHK-style format conversion  (!+w → Alt+Shift+W)
 *   - Chord hotkeys  (Alt+Shift+Q → Alt+R)
 *   - Named system hotkeys (promptChat, picker, etc.)
 *   - Dynamic per-prompt hotkey registration/unregistration
 */

import { createLogger } from "./logger";
import { ElectrobunShortcutBackend } from "../input-service/electrobun-shortcut-backend";
import {
  AssistantInputFacade,
  type AssistantHotkeyCallback as HotkeyCallback,
} from "../input-service/assistant/assistant-input-facade";

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
const shortcutBackend = new ElectrobunShortcutBackend();
const assistantInput = new AssistantInputFacade({
  backend: shortcutBackend,
  chordTimeoutMs: 900,
  hintDelayMs: 400,
  hintVisibleTimeoutMs: 5000,
});

const registered = new Map<string, string[]>();
const registeredInfo = new Map<string, RegisteredHotkeyInfo>();

export function setChordHintCallbacks(show: ChordHintShowFn, hide: () => void): void {
  assistantInput.setHintCallbacks(show, hide);
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

function registerSingle(name: string, accelerator: string, cb: HotkeyCallback): boolean {
  return shortcutBackend.registerShortcut({ id: name, accelerator }, () => {
    void cb();
  });
}

function unregisterSingle(name: string): void {
  shortcutBackend.unregisterShortcut(name);
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

function parseChord(spec: string): { prefix: string; suffix: string } | null {
  if (spec.includes("->")) {
    const [pre, suf] = spec.split("->").map((s) => ahkToAccelerator(s.trim()));
    return { prefix: pre, suffix: suf };
  }

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

export function registerHotkey(
  name: string,
  spec: string,
  cb: HotkeyCallback,
  label?: string,
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
  label?: string,
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

    const ok = assistantInput.registerChord(
      name,
      validation.prefix!,
      validation.suffix!,
      label ?? name,
      cb,
    );
    if (ok) {
      registered.set(name, [`__chord__${validation.prefix!}::${validation.suffix!}`]);
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
  if (owner || shortcutBackend.isRegistered(acc)) {
    return {
      ok: false,
      reason: "already_registered",
      owner,
      normalized: acc,
      kind: "single",
      errors: [],
    };
  }

  const ok = registerSingle(name, acc, cb);
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

export function unregisterHotkey(name: string): void {
  const keys = registered.get(name);
  if (!keys) return;

  for (const key of keys) {
    if (key.startsWith("__chord__")) {
      assistantInput.unregisterChord(name);
    } else {
      unregisterSingle(name);
    }
  }

  registered.delete(name);
  registeredInfo.delete(name);
}

export function unregisterAll(): void {
  assistantInput.unregisterAll();
  shortcutBackend.unregisterAll();
  registered.clear();
  registeredInfo.clear();
}

export function isRegistered(name: string): boolean {
  return registered.has(name);
}

export function updateHotkey(
  name: string,
  spec: string,
  cb: HotkeyCallback,
  label?: string,
): boolean {
  return updateHotkeyDetailed(name, spec, cb, label).ok;
}

export function updateHotkeyDetailed(
  name: string,
  spec: string,
  cb: HotkeyCallback,
  label?: string,
): HotkeyRegistrationResult {
  unregisterHotkey(name);
  return registerHotkeyDetailed(name, spec, cb, label);
}

export function getRegisteredHotkeys(): RegisteredHotkeyInfo[] {
  return Array.from(registeredInfo.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function initHotkeys(): Promise<void> {
  try {
    await assistantInput.start();
    log.info("input.backend_ready", { capabilities: shortcutBackend.capabilities });
  } catch (error) {
    log.warn("input.backend_start_failed", { error });
  }
}

export async function shutdownHotkeys(): Promise<void> {
  unregisterAll();
  await assistantInput.stop();
  log.info("input.backend_stopped");
}
