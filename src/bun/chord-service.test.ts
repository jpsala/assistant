import { describe, expect, test } from "bun:test";
import { createChordService, type ChordServiceScheduler, type ChordServiceTimer } from "./chord-service";
import type { ChordResolution } from "./chord-types";

class FakeTimer implements ChordServiceTimer {
  constructor(
    readonly dueAt: number,
    private readonly callback: () => void,
  ) {}

  cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  fire(): void {
    if (!this.cancelled) {
      this.cancelled = true;
      this.callback();
    }
  }
}

class FakeScheduler implements ChordServiceScheduler {
  nowMs = 0;
  timers: FakeTimer[] = [];

  now(): number {
    return this.nowMs;
  }

  setTimeout(cb: () => void, delayMs: number): ChordServiceTimer {
    const timer = new FakeTimer(this.nowMs + delayMs, cb);
    this.timers.push(timer);
    return timer;
  }

  activeTimers(): FakeTimer[] {
    return this.timers.filter((timer) => !timer.cancelled);
  }

  advanceBy(ms: number): void {
    this.nowMs += ms;
    for (const timer of [...this.timers]) {
      if (!timer.cancelled && timer.dueAt <= this.nowMs) {
        timer.fire();
      }
    }
    this.timers = this.timers.filter((timer) => !timer.cancelled);
  }
}

function expectCancelled(
  resolution: ChordResolution<unknown>,
  reason: "escape" | "timeout" | "invalid-key" | "replaced" | "empty-prefix" | "cancelled",
): void {
  expect(resolution.kind).toBe("cancelled");
  if (resolution.kind === "cancelled") {
    expect(resolution.reason).toBe(reason);
  }
}

describe("ChordService", () => {
  test("beginPrefix enters pending with timeout and hint entries", () => {
    const scheduler = new FakeScheduler();
    const service = createChordService({ timeoutMs: 900, scheduler });

    service.registerChord({ prefix: "Alt+R", suffix: "c", actionId: "capture", label: "Capture" });
    service.registerChord({ prefix: "Alt+R", suffix: "s", actionId: "summarize", label: "Summarize" });
    service.beginPrefix("Alt+R", 123);

    expect(service.getPendingState()).toEqual({
      sessionId: 1,
      prefix: "Alt+R",
      sourceHwnd: 123,
      startedAt: 0,
      deadlineAt: 900,
      entries: [
        { suffix: "C", label: "Capture", actionId: "capture" },
        { suffix: "S", label: "Summarize", actionId: "summarize" },
      ],
    });
    expect(scheduler.activeTimers()).toHaveLength(1);
  });

  test("valid suffix resolves match and clears pending state", () => {
    const scheduler = new FakeScheduler();
    const service = createChordService({ scheduler });

    service.registerChord({ prefix: "Alt+R", suffix: "c", actionId: "capture", label: "Capture" });
    service.beginPrefix("Alt+R", null);

    const resolution = service.handleKeyEvent({ type: "down", key: "c" });

    expect(resolution).toEqual({
      kind: "matched",
      match: { prefix: "Alt+R", suffix: "C", actionId: "capture", label: "Capture" },
      pending: {
        sessionId: 1,
        prefix: "Alt+R",
        sourceHwnd: null,
        startedAt: 0,
        deadlineAt: 900,
        entries: [{ suffix: "C", label: "Capture", actionId: "capture" }],
      },
    });
    expect(service.getPendingState()).toBeNull();
    expect(scheduler.activeTimers()).toHaveLength(0);
  });

  test("invalid key cancels the pending session", () => {
    const scheduler = new FakeScheduler();
    const service = createChordService({ scheduler });

    service.registerChord({ prefix: "Alt+R", suffix: "c", actionId: "capture", label: "Capture" });
    service.beginPrefix("Alt+R", null);

    const resolution = service.handleKeyEvent({ type: "down", key: "x" });

    expectCancelled(resolution, "invalid-key");
    expect(service.getPendingState()).toBeNull();
  });

  test("escape cancels the pending session", () => {
    const scheduler = new FakeScheduler();
    const service = createChordService({ scheduler });

    service.registerChord({ prefix: "Alt+R", suffix: "c", actionId: "capture", label: "Capture" });
    service.beginPrefix("Alt+R", null);

    const resolution = service.handleKeyEvent({ type: "down", key: "Escape" });

    expectCancelled(resolution, "escape");
    expect(service.getPendingState()).toBeNull();
  });

  test("timeout clears the pending state", () => {
    const scheduler = new FakeScheduler();
    const service = createChordService({ timeoutMs: 50, scheduler });

    service.registerChord({ prefix: "Alt+R", suffix: "c", actionId: "capture", label: "Capture" });
    service.beginPrefix("Alt+R", null);
    scheduler.advanceBy(50);

    expect(service.getPendingState()).toBeNull();
  });

  test("new prefix replaces the previous session without leaving timers active", () => {
    const scheduler = new FakeScheduler();
    const service = createChordService({ timeoutMs: 100, scheduler });

    service.registerChord({ prefix: "Alt+R", suffix: "c", actionId: "capture", label: "Capture" });
    service.beginPrefix("Alt+R", "first");
    const firstTimer = scheduler.activeTimers()[0];

    scheduler.advanceBy(10);
    service.beginPrefix("Alt+R", "second");

    expect(firstTimer.cancelled).toBe(true);
    expect(service.getPendingState()).toEqual({
      sessionId: 2,
      prefix: "Alt+R",
      sourceHwnd: "second",
      startedAt: 10,
      deadlineAt: 110,
      entries: [{ suffix: "C", label: "Capture", actionId: "capture" }],
    });
    expect(scheduler.activeTimers()).toHaveLength(1);
  });

  test("unregister removes actions from the internal maps and pending hint model", () => {
    const scheduler = new FakeScheduler();
    const service = createChordService({ scheduler });

    service.registerChord({ prefix: "Alt+R", suffix: "c", actionId: "capture", label: "Capture" });
    service.registerChord({ prefix: "Alt+R", suffix: "s", actionId: "summarize", label: "Summarize" });
    service.beginPrefix("Alt+R", null);

    service.unregisterChord("capture");

    expect(service.getPendingState()).toEqual({
      sessionId: 1,
      prefix: "Alt+R",
      sourceHwnd: null,
      startedAt: 0,
      deadlineAt: 900,
      entries: [{ suffix: "S", label: "Summarize", actionId: "summarize" }],
    });

    service.unregisterChord("summarize");

    expect(service.getPendingState()).toBeNull();
  });
});
