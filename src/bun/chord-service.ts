import { createLogger } from "./logger";
import type {
  ChordMatch,
  ChordResolution,
  KeyEvent,
  PendingChordState,
  ChordService,
} from "./chord-types";

type LoggerLike = ReturnType<typeof createLogger>;

export type ChordServiceTimer = {
  cancel(): void;
};

export type ChordServiceScheduler = {
  now(): number;
  setTimeout(cb: () => void, delayMs: number): ChordServiceTimer;
};

export type ChordServiceOptions = {
  timeoutMs?: number;
  scheduler?: ChordServiceScheduler;
  logger?: LoggerLike;
  onStateChange?: (pending: PendingChordState<unknown> | null) => void;
};

type RegisteredChord = ChordMatch;

const DEFAULT_TIMEOUT_MS = 900;

function createDefaultScheduler(): ChordServiceScheduler {
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
    default:
      return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
  }
}

function clonePendingState<TWindow>(state: PendingChordState<TWindow>): PendingChordState<TWindow> {
  return {
    ...state,
    entries: state.entries.map((entry) => ({ ...entry })),
  };
}

export class DefaultChordService<TWindow = unknown> implements ChordService<TWindow> {
  private readonly logger: LoggerLike;
  private readonly scheduler: ChordServiceScheduler;
  private readonly timeoutMs: number;
  private readonly onStateChange?: (pending: PendingChordState<TWindow> | null) => void;
  private readonly matchesByPrefix = new Map<string, Map<string, RegisteredChord>>();
  private readonly actionIndex = new Map<string, { prefix: string; suffix: string }>();
  private pendingState: PendingChordState<TWindow> | null = null;
  private pendingTimer: ChordServiceTimer | null = null;
  private nextSessionId = 0;

  constructor(options: ChordServiceOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scheduler = options.scheduler ?? createDefaultScheduler();
    this.logger = options.logger ?? createLogger("chord-service");
    this.onStateChange = options.onStateChange as ((pending: PendingChordState<TWindow> | null) => void) | undefined;
  }

  registerChord(match: ChordMatch): void {
    const prefix = normalizeKey(match.prefix);
    const suffix = normalizeKey(match.suffix);
    const normalized: RegisteredChord = {
      ...match,
      prefix,
      suffix,
    };

    const existing = this.actionIndex.get(match.actionId);
    if (existing) {
      this.deleteRegistration(existing.prefix, existing.suffix, match.actionId);
    }

    let suffixes = this.matchesByPrefix.get(prefix);
    if (!suffixes) {
      suffixes = new Map();
      this.matchesByPrefix.set(prefix, suffixes);
    }

    suffixes.set(suffix, normalized);
    this.actionIndex.set(match.actionId, { prefix, suffix });
    this.logger.info("chord_service.registered", {
      prefix,
      suffix,
      actionId: match.actionId,
      label: match.label,
    });

    if (this.pendingState && this.pendingState.prefix === prefix) {
      this.pendingState = this.buildPendingState(prefix, this.pendingState.sourceHwnd, this.pendingState.sessionId, this.pendingState.startedAt);
      this.emitStateChange();
    }
  }

  unregisterChord(actionId: string): void {
    const existing = this.actionIndex.get(actionId);
    if (!existing) return;

    this.deleteRegistration(existing.prefix, existing.suffix, actionId);
    this.logger.info("chord_service.unregistered", {
      prefix: existing.prefix,
      suffix: existing.suffix,
      actionId,
    });

    if (this.pendingState && this.pendingState.entries.every((entry) => entry.actionId !== actionId)) {
      return;
    }

    if (this.pendingState) {
      const nextState = this.buildPendingState(
        this.pendingState.prefix,
        this.pendingState.sourceHwnd,
        this.pendingState.sessionId,
        this.pendingState.startedAt,
      );
      if (nextState.entries.length === 0) {
        this.finishCancel("empty-prefix", undefined, nextState);
      } else {
        this.pendingState = nextState;
        this.emitStateChange();
      }
    }
  }

  beginPrefix(prefix: string, sourceHwnd: TWindow): void {
    const normalizedPrefix = normalizeKey(prefix);
    const startedAt = this.scheduler.now();
    const replaced = this.pendingState;
    if (replaced) {
      this.finishCancel("replaced", undefined, replaced);
    }

    const sessionId = ++this.nextSessionId;
    const nextState = this.buildPendingState(normalizedPrefix, sourceHwnd, sessionId, startedAt);
    if (nextState.entries.length === 0) {
      this.logger.warn("chord_service.prefix_started_without_entries", {
        sessionId,
        prefix: normalizedPrefix,
      });
      return;
    }

    this.pendingState = nextState;
    this.emitStateChange();
    this.pendingTimer = this.scheduler.setTimeout(() => {
      const timedOut = this.pendingState;
      if (!timedOut || timedOut.sessionId !== sessionId) return;
      this.finishCancel("timeout", undefined, timedOut);
    }, Math.max(nextState.deadlineAt - startedAt, 0));

    this.logger.info("chord_service.prefix_started", {
      sessionId,
      prefix: normalizedPrefix,
      suffixCount: nextState.entries.length,
      timeoutMs: this.timeoutMs,
    });
  }

  handleKeyEvent(event: KeyEvent): ChordResolution<TWindow> {
    const pending = this.pendingState;
    if (!pending) {
      return { kind: "ignored", reason: "idle" };
    }
    if (event.type === "up") {
      return { kind: "ignored", reason: "key-up" };
    }
    if (event.repeat) {
      return { kind: "ignored", reason: "repeat" };
    }

    const key = normalizeKey(event.key);
    if (key === "Esc") {
      return this.finishCancel("escape", key, pending);
    }

    const match = this.matchesByPrefix.get(pending.prefix)?.get(key);
    if (!match) {
      this.logger.info("chord_service.invalid_key", {
        sessionId: pending.sessionId,
        prefix: pending.prefix,
        suffix: key,
        elapsedMs: this.scheduler.now() - pending.startedAt,
      });
      return this.finishCancel("invalid-key", key, pending);
    }

    this.clearPendingTimer();
    this.pendingState = null;
    this.emitStateChange();
    this.logger.info("chord_service.suffix_matched", {
      sessionId: pending.sessionId,
      prefix: pending.prefix,
      suffix: match.suffix,
      actionId: match.actionId,
      elapsedMs: this.scheduler.now() - pending.startedAt,
    });
    return {
      kind: "matched",
      match: { ...match },
      pending: clonePendingState(pending),
    };
  }

  cancel(reason = "cancelled"): void {
    const pending = this.pendingState;
    if (!pending) return;
    this.finishCancel("cancelled", undefined, pending, reason);
  }

  getPendingState(): PendingChordState<TWindow> | null {
    return this.pendingState ? clonePendingState(this.pendingState) : null;
  }

  private buildPendingState(
    prefix: string,
    sourceHwnd: TWindow,
    sessionId: number,
    startedAt: number,
  ): PendingChordState<TWindow> {
    const entries = Array.from(this.matchesByPrefix.get(prefix)?.values() ?? [])
      .sort((a, b) => a.suffix.localeCompare(b.suffix))
      .map((match) => ({
        suffix: match.suffix,
        label: match.label,
        actionId: match.actionId,
      }));

    return {
      sessionId,
      prefix,
      sourceHwnd,
      startedAt,
      deadlineAt: startedAt + this.timeoutMs,
      entries,
    };
  }

  private finishCancel(
    reason: "cancelled" | "escape" | "timeout" | "invalid-key" | "replaced" | "empty-prefix",
    key: string | undefined,
    pending: PendingChordState<TWindow>,
    detail?: string,
  ): ChordResolution<TWindow> {
    this.clearPendingTimer();
    this.pendingState = null;
    this.emitStateChange();
    this.logger.info(reason === "timeout" ? "chord_service.timeout" : "chord_service.cancelled", {
      sessionId: pending.sessionId,
      prefix: pending.prefix,
      suffix: key,
      elapsedMs: this.scheduler.now() - pending.startedAt,
      reason: detail ?? reason,
    });
    return {
      kind: "cancelled",
      reason,
      pending: clonePendingState(pending),
      key,
    };
  }

  private clearPendingTimer(): void {
    this.pendingTimer?.cancel();
    this.pendingTimer = null;
  }

  private emitStateChange(): void {
    this.onStateChange?.(this.pendingState ? clonePendingState(this.pendingState) : null);
  }

  private deleteRegistration(prefix: string, suffix: string, actionId: string): void {
    const suffixes = this.matchesByPrefix.get(prefix);
    if (suffixes?.get(suffix)?.actionId === actionId) {
      suffixes.delete(suffix);
      if (suffixes.size === 0) {
        this.matchesByPrefix.delete(prefix);
      }
    }
    this.actionIndex.delete(actionId);
  }
}

export function createChordService<TWindow = unknown>(options?: ChordServiceOptions): ChordService<TWindow> {
  return new DefaultChordService<TWindow>(options);
}

export { normalizeKey };
