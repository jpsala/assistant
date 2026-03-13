import { describe, expect, test } from "bun:test";
import { matchesPrefix, parseAccelerator } from "./windows-keyboard-backend";
import type { KeyEvent } from "./keyboard-backend";

function keyEvent(overrides: Partial<KeyEvent>): KeyEvent {
  return {
    type: "down",
    key: "R",
    alt: false,
    ctrl: false,
    shift: false,
    meta: false,
    repeat: false,
    timestamp: 0,
    ...overrides,
  };
}

describe("WindowsKeyboardBackend helpers", () => {
  test("parseAccelerator extracts key and modifiers", () => {
    expect(parseAccelerator("Alt+Shift+R")).toEqual({
      key: "R",
      alt: true,
      ctrl: false,
      shift: true,
      meta: false,
    });
  });

  test("matchesPrefix accepts exact keydown match", () => {
    const prefix = parseAccelerator("Alt+R");
    expect(matchesPrefix(prefix, keyEvent({ alt: true }))).toBe(true);
  });

  test("matchesPrefix rejects modifier mismatch", () => {
    const prefix = parseAccelerator("Alt+R");
    expect(matchesPrefix(prefix, keyEvent({ alt: false }))).toBe(false);
  });

  test("matchesPrefix rejects repeat and key-up events", () => {
    const prefix = parseAccelerator("Alt+R");
    expect(matchesPrefix(prefix, keyEvent({ alt: true, repeat: true }))).toBe(false);
    expect(matchesPrefix(prefix, keyEvent({ alt: true, type: "up" }))).toBe(false);
  });
});
