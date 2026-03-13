import { describe, expect, test } from "bun:test";
import {
  createInputService,
  type InputService,
} from "./input-service";
import type {
  InputServiceScheduler,
  InputServiceTimer,
  InputResolution,
} from "./input-types";

class FakeTimer implements InputServiceTimer {
  constructor(
    readonly dueAt: number,
    private readonly callback: () => void,
  ) {}

  cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  fire(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.callback();
  }
}

class FakeScheduler implements InputServiceScheduler {
  nowMs = 0;
  timers: FakeTimer[] = [];

  now(): number {
    return this.nowMs;
  }

  setTimeout(cb: () => void, delayMs: number): InputServiceTimer {
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

function createService(scheduler = new FakeScheduler()): {
  scheduler: FakeScheduler;
  service: InputService<string>;
} {
  return {
    scheduler,
    service: createInputService<string>({ scheduler }),
  };
}

function expectCancelled(
  resolution: InputResolution<string>,
  reason: "cancelled" | "escape" | "timeout" | "invalid-key" | "replaced" | "empty-prefix",
): void {
  expect(resolution.kind).toBe("cancelled");
  if (resolution.kind === "cancelled") {
    expect(resolution.reason).toBe(reason);
  }
}

describe("InputService", () => {
  test("matches a registered single trigger semantically", () => {
    const { service } = createService();
    service.registerAction({ id: "open-chat", title: "Open Chat" });
    service.registerSingle({ kind: "single", accelerator: "alt+shift+w", actionId: "open-chat" });

    const resolution = service.handleTrigger("Alt+Shift+W", "editor");

    expect(resolution).toEqual({
      kind: "matched",
      actionId: "open-chat",
      trigger: "single",
      accelerator: "Alt+Shift+W",
      source: "editor",
    });
  });

  test("beginMode enters pending with mode entries and hint model", () => {
    const { service, scheduler } = createService();
    service.registerAction({ id: "capture", title: "Capture" });
    service.registerAction({ id: "summarize", title: "Summarize" });
    service.registerMode({
      id: "assistant",
      title: "Assistant",
      prefix: "Alt+R",
      entries: [
        { key: "c", title: "Capture", actionId: "capture" },
        { key: "s", title: "Summarize", actionId: "summarize" },
      ],
    });

    const resolution = service.beginMode("Alt+R", "notepad");

    expect(resolution).toEqual({
      kind: "pending-started",
      sessionId: 1,
      prefix: "Alt+R",
      modeId: "assistant",
      entries: [
        { key: "C", accelerator: "C", title: "Capture", actionId: "capture" },
        { key: "S", accelerator: "S", title: "Summarize", actionId: "summarize" },
      ],
      source: "notepad",
    });
    expect(service.getState()).toEqual({
      status: "pending",
      sessionId: 1,
      prefix: "Alt+R",
      modeId: "assistant",
      source: "notepad",
      startedAt: 0,
      deadlineAt: 900,
      entries: [
        { key: "C", accelerator: "C", title: "Capture", actionId: "capture" },
        { key: "S", accelerator: "S", title: "Summarize", actionId: "summarize" },
      ],
      activeActionId: null,
      lastResolution: resolution,
    });
    expect(service.getHintModel()).toEqual({
      sessionId: 1,
      prefix: "Alt+R",
      modeId: "assistant",
      entries: [
        { key: "C", accelerator: "C", title: "Capture", actionId: "capture" },
        { key: "S", accelerator: "S", title: "Summarize", actionId: "summarize" },
      ],
      startedAt: 0,
      deadlineAt: 900,
    });
    expect(scheduler.activeTimers()).toHaveLength(1);
  });

  test("valid suffix resolves pending match", () => {
    const { service } = createService();
    service.registerAction({ id: "capture", title: "Capture" });
    service.registerChord({ kind: "chord", prefix: "Alt+R", suffix: "c", actionId: "capture" });
    service.beginMode("Alt+R", "terminal");

    const resolution = service.handleKeyEvent({ type: "down", key: "c" });

    expect(resolution).toEqual({
      kind: "matched",
      actionId: "capture",
      trigger: "pending",
      pendingSessionId: 1,
      source: "terminal",
    });
    expect(service.getHintModel()).toBeNull();
  });

  test("invalid key cancels the pending session", () => {
    const { service } = createService();
    service.registerAction({ id: "capture", title: "Capture" });
    service.registerChord({ kind: "chord", prefix: "Alt+R", suffix: "c", actionId: "capture" });
    service.beginMode("Alt+R", "terminal");

    const resolution = service.handleKeyEvent({ type: "down", key: "x" });

    expectCancelled(resolution, "invalid-key");
    expect(service.getState().status).toBe("idle");
  });

  test("escape cancels the pending session", () => {
    const { service } = createService();
    service.registerAction({ id: "capture", title: "Capture" });
    service.registerChord({ kind: "chord", prefix: "Alt+R", suffix: "c", actionId: "capture" });
    service.beginMode("Alt+R", "terminal");

    const resolution = service.handleKeyEvent({ type: "down", key: "Escape" });

    expectCancelled(resolution, "escape");
  });

  test("timeout clears the pending state", () => {
    const scheduler = new FakeScheduler();
    const service = createInputService<string>({ scheduler, timeoutMs: 50 });
    service.registerAction({ id: "capture", title: "Capture" });
    service.registerChord({ kind: "chord", prefix: "Alt+R", suffix: "c", actionId: "capture" });
    service.beginMode("Alt+R", "terminal");

    scheduler.advanceBy(50);

    expect(service.getState().status).toBe("idle");
    expect(service.getState().lastResolution).toEqual({
      kind: "cancelled",
      reason: "timeout",
      sessionId: 1,
      prefix: "Alt+R",
      modeId: null,
      source: "terminal",
    });
  });

  test("new session replaces the previous one without leaving timers active", () => {
    const { service, scheduler } = createService();
    service.registerAction({ id: "capture", title: "Capture" });
    service.registerChord({ kind: "chord", prefix: "Alt+R", suffix: "c", actionId: "capture" });
    service.beginMode("Alt+R", "first");
    const firstTimer = scheduler.activeTimers()[0];

    scheduler.advanceBy(10);
    service.beginMode("Alt+R", "second");

    expect(firstTimer.cancelled).toBe(true);
    expect(service.getState()).toEqual({
      status: "pending",
      sessionId: 2,
      prefix: "Alt+R",
      modeId: null,
      source: "second",
      startedAt: 10,
      deadlineAt: 910,
      entries: [{ key: "C", accelerator: "C", title: "Capture", actionId: "capture" }],
      activeActionId: null,
      lastResolution: {
        kind: "pending-started",
        sessionId: 2,
        prefix: "Alt+R",
        modeId: null,
        entries: [{ key: "C", accelerator: "C", title: "Capture", actionId: "capture" }],
        source: "second",
      },
    });
    expect(scheduler.activeTimers()).toHaveLength(1);
  });

  test("unregisterTrigger updates pending entries and cancels when the prefix becomes empty", () => {
    const { service } = createService();
    service.registerAction({ id: "capture", title: "Capture" });
    service.registerAction({ id: "summarize", title: "Summarize" });
    service.registerChord({ kind: "chord", prefix: "Alt+R", suffix: "c", actionId: "capture" });
    service.registerChord({ kind: "chord", prefix: "Alt+R", suffix: "s", actionId: "summarize" });
    service.beginMode("Alt+R", "editor");

    service.unregisterTrigger("capture");
    expect(service.getHintModel()).toEqual({
      sessionId: 1,
      prefix: "Alt+R",
      modeId: null,
      entries: [{ key: "S", accelerator: "S", title: "Summarize", actionId: "summarize" }],
      startedAt: 0,
      deadlineAt: 900,
    });

    service.unregisterTrigger("summarize");
    expect(service.getState().lastResolution).toEqual({
      kind: "cancelled",
      reason: "empty-prefix",
      sessionId: 1,
      prefix: "Alt+R",
      modeId: null,
      source: "editor",
    });
  });

  test("handleTrigger starts pending mode from prefix registration", () => {
    const { service } = createService();
    service.registerAction({ id: "capture", title: "Capture" });
    service.registerMode({
      id: "assistant",
      title: "Assistant",
      prefix: "Alt+R",
      entries: [{ key: "c", title: "Capture", actionId: "capture" }],
      timeoutMs: 1200,
    });

    const resolution = service.handleTrigger("Alt+R", "browser");

    expect(resolution).toEqual({
      kind: "pending-started",
      sessionId: 1,
      prefix: "Alt+R",
      modeId: "assistant",
      entries: [{ key: "C", accelerator: "C", title: "Capture", actionId: "capture" }],
      source: "browser",
    });
    expect(service.getHintModel()?.deadlineAt).toBe(1200);
  });

  test("handlePendingTrigger matches a registered suffix accelerator in fallback flows", () => {
    const { service } = createService();
    service.registerAction({ id: "capture", title: "Capture" });
    service.registerChord({ kind: "chord", prefix: "Alt+R", suffix: "Alt+X", actionId: "capture" });
    service.beginMode("Alt+R", "browser");

    const resolution = service.handlePendingTrigger("Alt+X");

    expect(resolution).toEqual({
      kind: "matched",
      actionId: "capture",
      trigger: "pending",
      pendingSessionId: 1,
      source: "browser",
    });
  });

  test("extendPendingTimeout keeps a visible pending session alive longer", () => {
    const scheduler = new FakeScheduler();
    const service = createInputService<string>({ scheduler, timeoutMs: 900 });
    service.registerAction({ id: "capture", title: "Capture" });
    service.registerChord({ kind: "chord", prefix: "Alt+R", suffix: "c", actionId: "capture" });
    service.beginMode("Alt+R", "editor");

    scheduler.advanceBy(450);
    expect(service.extendPendingTimeout(5000)).toBe(true);
    expect(service.getHintModel()?.deadlineAt).toBe(5450);

    scheduler.advanceBy(449);
    expect(service.getState().status).toBe("pending");

    scheduler.advanceBy(4551);
    expect(service.getState().status).toBe("idle");
    expect(service.getState().lastResolution).toEqual({
      kind: "cancelled",
      reason: "timeout",
      sessionId: 1,
      prefix: "Alt+R",
      modeId: null,
      source: "editor",
    });
  });
});
