import { createLogger } from "../../bun/logger";
import { buildHintModel, type HintModel } from "./hint-model";
import { cloneState, createIdleState, type InputState } from "./input-state";
import type {
  ActionDefinition,
  ActionId,
  ChordTrigger,
  InputCancelReason,
  InputResolution,
  InputServiceScheduler,
  InputServiceTimer,
  KeyEvent,
  ModeDefinition,
  ModeId,
  PendingEntry,
  SingleTrigger,
} from "./input-types";

type LoggerLike = ReturnType<typeof createLogger>;

type InputServiceOptions<TSource> = {
  timeoutMs?: number;
  scheduler?: InputServiceScheduler;
  logger?: LoggerLike;
  onStateChange?: (state: InputState<TSource>) => void;
};

type PendingSession<TSource> = {
  sessionId: number;
  prefix: string;
  modeId: ModeId | null;
  source: TSource | null;
  startedAt: number;
  deadlineAt: number;
  entries: PendingEntry[];
};

type ChordRegistration = {
  prefix: string;
  suffix: string;
  actionId: ActionId;
};

const DEFAULT_TIMEOUT_MS = 900;

function createDefaultScheduler(): InputServiceScheduler {
  return {
    now: () => Date.now(),
    setTimeout(cb, delayMs) {
      const handle = setTimeout(cb, delayMs);
      return {
        cancel() {
          clearTimeout(handle);
        },
      };
    },
  };
}

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();

  switch (lower) {
    case "alt":
      return "Alt";
    case "shift":
      return "Shift";
    case "escape":
    case "esc":
      return "Esc";
    case "space":
    case " ":
      return "Space";
    case "enter":
      return "Enter";
    case "tab":
      return "Tab";
    case "meta":
    case "win":
    case "cmd":
    case "super":
      return "Meta";
    case "control":
      return "Ctrl";
    default:
      return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
  }
}

function normalizeAccelerator(spec: string): string {
  const parts = spec
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return normalizeKey(parts[0]);

  const modifiers = new Set<string>();
  const keys: string[] = [];

  for (const part of parts) {
    const normalized = normalizeKey(part);
    if (normalized === "Ctrl" || normalized === "Alt" || normalized === "Shift" || normalized === "Meta") {
      modifiers.add(normalized);
    } else {
      keys.push(normalized);
    }
  }

  const orderedModifiers = ["Ctrl", "Alt", "Shift", "Meta"].filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers, ...keys].join("+");
}

function cloneEntries(entries: PendingEntry[]): PendingEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export interface InputService<TSource = unknown> {
  registerAction(action: ActionDefinition): void;
  unregisterAction(actionId: ActionId): void;
  registerSingle(trigger: SingleTrigger): void;
  registerChord(trigger: ChordTrigger): void;
  registerMode(mode: ModeDefinition): void;
  unregisterTrigger(actionId: ActionId): void;
  unregisterMode(modeId: ModeId): void;
  beginMode(prefix: string, source?: TSource | null): InputResolution<TSource>;
  handleTrigger(accelerator: string, source?: TSource | null): InputResolution<TSource>;
  handlePendingTrigger(accelerator: string): InputResolution<TSource>;
  handleKeyEvent(event: KeyEvent): InputResolution<TSource>;
  cancel(reason?: string): InputResolution<TSource>;
  extendPendingTimeout(delayMs: number): boolean;
  getState(): InputState<TSource>;
  getHintModel(): HintModel | null;
  onStateChange(listener: (state: InputState<TSource>) => void): () => void;
}

export class DefaultInputService<TSource = unknown> implements InputService<TSource> {
  private readonly logger: LoggerLike;
  private readonly scheduler: InputServiceScheduler;
  private readonly timeoutMs: number;
  private readonly actions = new Map<ActionId, ActionDefinition>();
  private readonly singlesByAccelerator = new Map<string, ActionId>();
  private readonly chordsByPrefix = new Map<string, Map<string, ActionId>>();
  private readonly chordsByAction = new Map<ActionId, ChordRegistration>();
  private readonly singlesByAction = new Map<ActionId, string>();
  private readonly modesById = new Map<ModeId, ModeDefinition>();
  private readonly modeIdsByPrefix = new Map<string, ModeId>();
  private readonly listeners = new Set<(state: InputState<TSource>) => void>();
  private state = createIdleState<TSource>();
  private pendingSession: PendingSession<TSource> | null = null;
  private pendingTimer: InputServiceTimer | null = null;
  private nextSessionId = 0;

  constructor(options: InputServiceOptions<TSource> = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scheduler = options.scheduler ?? createDefaultScheduler();
    this.logger = options.logger ?? createLogger("input-service");
    if (options.onStateChange) {
      this.listeners.add(options.onStateChange);
    }
  }

  registerAction(action: ActionDefinition): void {
    this.actions.set(action.id, { ...action });
    this.logger.info("input_service.action_registered", {
      actionId: action.id,
      title: action.title,
    });
  }

  unregisterAction(actionId: ActionId): void {
    if (!this.actions.delete(actionId)) return;
    this.unregisterTrigger(actionId);
    this.logger.info("input_service.action_unregistered", { actionId });
  }

  registerSingle(trigger: SingleTrigger): void {
    const accelerator = normalizeAccelerator(trigger.accelerator);
    const previous = this.singlesByAction.get(trigger.actionId);
    if (previous) {
      this.singlesByAccelerator.delete(previous);
    }
    this.singlesByAction.set(trigger.actionId, accelerator);
    this.singlesByAccelerator.set(accelerator, trigger.actionId);
  }

  registerChord(trigger: ChordTrigger): void {
    const prefix = normalizeAccelerator(trigger.prefix);
    const suffix = normalizeKey(trigger.suffix);
    const existing = this.chordsByAction.get(trigger.actionId);
    if (existing) {
      this.deleteChord(existing);
    }

    let suffixMap = this.chordsByPrefix.get(prefix);
    if (!suffixMap) {
      suffixMap = new Map();
      this.chordsByPrefix.set(prefix, suffixMap);
    }
    suffixMap.set(suffix, trigger.actionId);
    this.chordsByAction.set(trigger.actionId, { prefix, suffix, actionId: trigger.actionId });
    this.refreshPendingForPrefix(prefix);
  }

  registerMode(mode: ModeDefinition): void {
    const normalizedPrefix = normalizeAccelerator(mode.prefix);
    const normalized: ModeDefinition = {
      ...mode,
      prefix: normalizedPrefix,
      entries: mode.entries.map((entry) => ({
        ...entry,
        key: normalizeKey(entry.key),
      })),
    };

    const previous = this.modesById.get(mode.id);
    if (previous) {
      this.modeIdsByPrefix.delete(previous.prefix);
    }

    this.modesById.set(mode.id, normalized);
    this.modeIdsByPrefix.set(normalizedPrefix, mode.id);
    this.logger.info("input_service.mode_registered", {
      modeId: mode.id,
      prefix: normalizedPrefix,
      entryCount: normalized.entries.length,
    });
    this.refreshPendingForPrefix(normalizedPrefix);
  }

  unregisterTrigger(actionId: ActionId): void {
    const single = this.singlesByAction.get(actionId);
    if (single) {
      this.singlesByAction.delete(actionId);
      this.singlesByAccelerator.delete(single);
    }

    const chord = this.chordsByAction.get(actionId);
    if (chord) {
      this.deleteChord(chord);
      this.refreshPendingForPrefix(chord.prefix);
    }
  }

  unregisterMode(modeId: ModeId): void {
    const existing = this.modesById.get(modeId);
    if (!existing) return;
    this.modesById.delete(modeId);
    this.modeIdsByPrefix.delete(existing.prefix);
    this.logger.info("input_service.mode_unregistered", {
      modeId,
      prefix: existing.prefix,
    });
    this.refreshPendingForPrefix(existing.prefix);
  }

  beginMode(prefix: string, source: TSource | null = null): InputResolution<TSource> {
    const normalizedPrefix = normalizeAccelerator(prefix);
    const startedAt = this.scheduler.now();
    const replaced = this.pendingSession;
    if (replaced) {
      this.finishCancel("replaced", replaced);
    }

    const nextSession = this.buildPendingSession(normalizedPrefix, source, startedAt);
    if (nextSession.entries.length === 0) {
      return this.setResolution({ kind: "ignored", reason: "empty-prefix" });
    }

    this.pendingSession = nextSession;
    this.pendingTimer = this.scheduler.setTimeout(() => {
      const current = this.pendingSession;
      if (!current || current.sessionId !== nextSession.sessionId) return;
      this.logger.info("input_service.timeout", {
        sessionId: current.sessionId,
        prefix: current.prefix,
        elapsedMs: this.scheduler.now() - current.startedAt,
      });
      this.finishCancel("timeout", current);
    }, Math.max(nextSession.deadlineAt - startedAt, 0));

    this.state = {
      status: "pending",
      sessionId: nextSession.sessionId,
      prefix: nextSession.prefix,
      modeId: nextSession.modeId,
      source: nextSession.source,
      startedAt: nextSession.startedAt,
      deadlineAt: nextSession.deadlineAt,
      entries: cloneEntries(nextSession.entries),
      activeActionId: null,
      lastResolution: null,
    };
    const resolution = this.setResolution({
      kind: "pending-started",
      sessionId: nextSession.sessionId,
      prefix: nextSession.prefix,
      modeId: nextSession.modeId,
      entries: cloneEntries(nextSession.entries),
      source: nextSession.source,
    });
    this.logger.info("input_service.pending_started", {
      sessionId: nextSession.sessionId,
      prefix: nextSession.prefix,
      modeId: nextSession.modeId,
      entryCount: nextSession.entries.length,
      timeoutMs: nextSession.deadlineAt - nextSession.startedAt,
    });
    return resolution;
  }

  handleTrigger(accelerator: string, source: TSource | null = null): InputResolution<TSource> {
    const normalized = normalizeAccelerator(accelerator);
    const singleActionId = this.singlesByAccelerator.get(normalized);
    if (singleActionId) {
      this.state = {
        ...createIdleState<TSource>(),
        status: "executing",
        source,
        activeActionId: singleActionId,
      };
      const resolution = this.setResolution({
        kind: "matched",
        actionId: singleActionId,
        trigger: "single",
        accelerator: normalized,
        source,
      });
      this.logger.info("input_service.matched", {
        actionId: singleActionId,
        accelerator: normalized,
        trigger: "single",
      });
      return resolution;
    }

    if (this.chordsByPrefix.has(normalized) || this.modeIdsByPrefix.has(normalized)) {
      return this.beginMode(normalized, source);
    }

    return this.setResolution({ kind: "ignored", reason: "no-trigger" });
  }

  handleKeyEvent(event: KeyEvent): InputResolution<TSource> {
    const pending = this.pendingSession;
    if (!pending) {
      return this.setResolution({ kind: "ignored", reason: "idle" });
    }
    if (event.type === "up") {
      return this.setResolution({ kind: "ignored", reason: "key-up" });
    }
    if (event.repeat) {
      return this.setResolution({ kind: "ignored", reason: "repeat" });
    }

    const key = normalizeKey(event.key);
    if (key === "Esc") {
      return this.finishCancel("escape", pending, key);
    }

    const actionId = pending.entries.find((entry) => entry.key === key)?.actionId;
    if (!actionId) {
      this.logger.info("input_service.invalid_key", {
        sessionId: pending.sessionId,
        prefix: pending.prefix,
        key,
        modeId: pending.modeId,
        elapsedMs: this.scheduler.now() - pending.startedAt,
      });
      return this.finishCancel("invalid-key", pending, key);
    }

    this.clearPendingTimer();
    this.pendingSession = null;
    this.state = {
      ...createIdleState<TSource>(),
      status: "executing",
      source: pending.source,
      activeActionId: actionId,
    };
    const resolution = this.setResolution({
      kind: "matched",
      actionId,
      trigger: "pending",
      pendingSessionId: pending.sessionId,
      source: pending.source,
    });
    this.logger.info("input_service.matched", {
      sessionId: pending.sessionId,
      prefix: pending.prefix,
      key,
      actionId,
      modeId: pending.modeId,
      elapsedMs: this.scheduler.now() - pending.startedAt,
      trigger: "pending",
    });
    return resolution;
  }

  handlePendingTrigger(accelerator: string): InputResolution<TSource> {
    const pending = this.pendingSession;
    if (!pending) {
      return this.setResolution({ kind: "ignored", reason: "idle" });
    }

    const normalized = normalizeAccelerator(accelerator);
    const actionId = pending.entries.find((entry) => entry.accelerator === normalized)?.actionId;
    if (!actionId) {
      this.logger.info("input_service.invalid_key", {
        sessionId: pending.sessionId,
        prefix: pending.prefix,
        key: normalized,
        modeId: pending.modeId,
        elapsedMs: this.scheduler.now() - pending.startedAt,
      });
      return this.finishCancel("invalid-key", pending, normalized);
    }

    this.clearPendingTimer();
    this.pendingSession = null;
    this.state = {
      ...createIdleState<TSource>(),
      status: "executing",
      source: pending.source,
      activeActionId: actionId,
    };
    const resolution = this.setResolution({
      kind: "matched",
      actionId,
      trigger: "pending",
      pendingSessionId: pending.sessionId,
      source: pending.source,
    });
    this.logger.info("input_service.matched", {
      sessionId: pending.sessionId,
      prefix: pending.prefix,
      key: normalized,
      actionId,
      modeId: pending.modeId,
      elapsedMs: this.scheduler.now() - pending.startedAt,
      trigger: "pending",
    });
    return resolution;
  }

  cancel(reason = "cancelled"): InputResolution<TSource> {
    const pending = this.pendingSession;
    if (!pending) {
      return this.setResolution({ kind: "ignored", reason: "idle" });
    }
    return this.finishCancel("cancelled", pending, undefined, reason);
  }

  extendPendingTimeout(delayMs: number): boolean {
    const pending = this.pendingSession;
    if (!pending) return false;

    const nextDeadlineAt = this.scheduler.now() + Math.max(delayMs, 0);
    if (nextDeadlineAt <= pending.deadlineAt) {
      return true;
    }

    pending.deadlineAt = nextDeadlineAt;
    this.clearPendingTimer();
    this.pendingTimer = this.scheduler.setTimeout(() => {
      const current = this.pendingSession;
      if (!current || current.sessionId !== pending.sessionId) return;
      this.logger.info("input_service.timeout", {
        sessionId: current.sessionId,
        prefix: current.prefix,
        elapsedMs: this.scheduler.now() - current.startedAt,
      });
      this.finishCancel("timeout", current);
    }, Math.max(nextDeadlineAt - this.scheduler.now(), 0));

    this.state = {
      ...this.state,
      deadlineAt: nextDeadlineAt,
    };
    this.emitStateChange();
    return true;
  }

  getState(): InputState<TSource> {
    return cloneState(this.state);
  }

  getHintModel(): HintModel | null {
    return buildHintModel(this.state);
  }

  onStateChange(listener: (state: InputState<TSource>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private buildPendingSession(prefix: string, source: TSource | null, startedAt: number): PendingSession<TSource> {
    const mode = this.getModeForPrefix(prefix);
    const entries = new Map<string, PendingEntry>();

    for (const [suffix, actionId] of this.chordsByPrefix.get(prefix) ?? []) {
      entries.set(suffix, {
        key: suffix,
        accelerator: suffix,
        title: this.actions.get(actionId)?.title ?? actionId,
        actionId,
      });
    }

    for (const entry of mode?.entries ?? []) {
      entries.set(entry.key, {
        ...entry,
        accelerator: normalizeAccelerator(entry.key),
      });
    }

    const timeoutMs = mode?.timeoutMs ?? this.timeoutMs;
    return {
      sessionId: ++this.nextSessionId,
      prefix,
      modeId: mode?.id ?? null,
      source,
      startedAt,
      deadlineAt: startedAt + timeoutMs,
      entries: Array.from(entries.values()).sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  private getModeForPrefix(prefix: string): ModeDefinition | null {
    const modeId = this.modeIdsByPrefix.get(prefix);
    if (!modeId) return null;
    return this.modesById.get(modeId) ?? null;
  }

  private refreshPendingForPrefix(prefix: string): void {
    const pending = this.pendingSession;
    if (!pending || pending.prefix !== prefix) return;

    const nextSession = this.buildPendingSession(prefix, pending.source, pending.startedAt);
    nextSession.sessionId = pending.sessionId;
    if (nextSession.entries.length === 0) {
      this.finishCancel("empty-prefix", pending);
      return;
    }

    nextSession.deadlineAt = pending.deadlineAt;
    this.pendingSession = nextSession;
    this.state = {
      ...this.state,
      status: "pending",
      sessionId: nextSession.sessionId,
      prefix: nextSession.prefix,
      modeId: nextSession.modeId,
      source: nextSession.source,
      startedAt: nextSession.startedAt,
      deadlineAt: nextSession.deadlineAt,
      entries: cloneEntries(nextSession.entries),
      activeActionId: null,
    };
    this.emitStateChange();
  }

  private deleteChord(registration: ChordRegistration): void {
    const suffixes = this.chordsByPrefix.get(registration.prefix);
    if (suffixes?.get(registration.suffix) === registration.actionId) {
      suffixes.delete(registration.suffix);
      if (suffixes.size === 0) {
        this.chordsByPrefix.delete(registration.prefix);
      }
    }
    this.chordsByAction.delete(registration.actionId);
  }

  private finishCancel(
    reason: InputCancelReason,
    pending: PendingSession<TSource>,
    key?: string,
    detail?: string,
  ): InputResolution<TSource> {
    this.clearPendingTimer();
    this.pendingSession = null;
    this.state = {
      ...createIdleState<TSource>(),
      source: pending.source,
    };
    const resolution = this.setResolution({
      kind: "cancelled",
      reason,
      sessionId: pending.sessionId,
      prefix: pending.prefix,
      modeId: pending.modeId,
      key,
      source: pending.source,
    });
    this.logger.info(reason === "timeout" ? "input_service.timeout" : "input_service.cancelled", {
      sessionId: pending.sessionId,
      prefix: pending.prefix,
      key,
      modeId: pending.modeId,
      elapsedMs: this.scheduler.now() - pending.startedAt,
      reason: detail ?? reason,
    });
    return resolution;
  }

  private clearPendingTimer(): void {
    this.pendingTimer?.cancel();
    this.pendingTimer = null;
  }

  private setResolution(resolution: InputResolution<TSource>): InputResolution<TSource> {
    this.state.lastResolution = resolution.kind === "pending-started"
      ? { ...resolution, entries: cloneEntries(resolution.entries) }
      : { ...resolution };
    this.emitStateChange();
    return this.state.lastResolution;
  }

  private emitStateChange(): void {
    const snapshot = cloneState(this.state);
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function createInputService<TSource = unknown>(
  options?: InputServiceOptions<TSource>,
): InputService<TSource> {
  return new DefaultInputService(options);
}

export { normalizeAccelerator, normalizeKey };
