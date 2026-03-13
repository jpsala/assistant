import { captureSelectedText, getForegroundWindow, releaseModifiers, type CaptureResult } from "../../bun/ffi";
import { createLogger } from "../../bun/logger";
import { createInputService, type InputService } from "../core/input-service";
import type { InputBackend } from "../backend-types";
import type { HintModel } from "../core/hint-model";

export type AssistantHotkeyTriggerContext = {
  preCaptured?: CaptureResult;
};

export type AssistantHotkeyCallback = (
  context?: AssistantHotkeyTriggerContext,
) => void | Promise<void>;

type HintCallbacks = {
  show: (prefix: string, entries: { key: string; label: string }[]) => void;
  hide: () => void;
};

type RegisteredAction = {
  actionId: string;
  prefix: string;
  suffix: string;
  label: string;
  callback: AssistantHotkeyCallback;
};

type ActivePrefixState = {
  sourceHwnd: unknown;
  suffixIds: string[];
};

type AssistantInputFacadeOptions = {
  backend: InputBackend;
  chordTimeoutMs?: number;
  hintDelayMs?: number;
  hintVisibleTimeoutMs?: number;
};

const log = createLogger("assistant-input");

export class AssistantInputFacade {
  private readonly backend: InputBackend;
  private readonly inputService: InputService<unknown>;
  private readonly hintDelayMs: number;
  private readonly hintVisibleTimeoutMs: number;
  private readonly actionsById = new Map<string, RegisteredAction>();
  private readonly actionIdsByPrefix = new Map<string, Set<string>>();
  private readonly activePrefixes = new Map<string, ActivePrefixState>();
  private hintCallbacks: HintCallbacks = {
    show: () => {},
    hide: () => {},
  };
  private hintTimer: Timer | null = null;
  private visibleHintSessionId: number | null = null;
  private suppressHintSync = false;

  constructor(options: AssistantInputFacadeOptions) {
    this.backend = options.backend;
    this.hintDelayMs = options.hintDelayMs ?? 400;
    this.hintVisibleTimeoutMs = options.hintVisibleTimeoutMs ?? 5000;
    this.inputService = createInputService<unknown>({
      timeoutMs: options.chordTimeoutMs ?? 900,
      onStateChange: () => {
        this.syncPendingRegistrations();
        this.syncHint();
      },
    });
  }

  async start(): Promise<void> {
    await this.backend.start();
  }

  async stop(): Promise<void> {
    this.clearHintState();
    this.activePrefixes.clear();
    await this.backend.stop();
  }

  setHintCallbacks(show: HintCallbacks["show"], hide: HintCallbacks["hide"]): void {
    this.hintCallbacks = { show, hide };
  }

  registerChord(
    actionId: string,
    prefix: string,
    suffix: string,
    label: string,
    callback: AssistantHotkeyCallback,
  ): boolean {
    const existing = this.actionsById.get(actionId);
    if (existing) {
      this.unregisterChord(actionId);
    }

    this.inputService.registerAction({ id: actionId, title: label });
    this.inputService.registerChord({ kind: "chord", prefix, suffix, actionId });

    const action: RegisteredAction = {
      actionId,
      prefix,
      suffix,
      label,
      callback,
    };
    this.actionsById.set(actionId, action);

    let ids = this.actionIdsByPrefix.get(prefix);
    if (!ids) {
      ids = new Set<string>();
      this.actionIdsByPrefix.set(prefix, ids);
    }
    ids.add(actionId);

    if (ids.size === 1) {
      const ok = this.backend.registerShortcut(
        { id: this.getPrefixRegistrationId(prefix), accelerator: prefix },
        () => {
          releaseModifiers();
          const sourceHwnd = getForegroundWindow();
          this.inputService.beginMode(prefix, sourceHwnd);
        },
      );
      if (!ok) {
        ids.delete(actionId);
        if (ids.size === 0) {
          this.actionIdsByPrefix.delete(prefix);
        }
        this.actionsById.delete(actionId);
        this.inputService.unregisterTrigger(actionId);
        this.inputService.unregisterAction(actionId);
        return false;
      }
    }

    return true;
  }

  unregisterChord(actionId: string): void {
    const existing = this.actionsById.get(actionId);
    if (!existing) return;

    this.actionsById.delete(actionId);
    this.inputService.unregisterTrigger(actionId);
    this.inputService.unregisterAction(actionId);

    const ids = this.actionIdsByPrefix.get(existing.prefix);
    ids?.delete(actionId);
    if (ids && ids.size === 0) {
      this.actionIdsByPrefix.delete(existing.prefix);
      this.deactivatePrefix(existing.prefix);
      this.backend.unregisterShortcut(this.getPrefixRegistrationId(existing.prefix));
    }
  }

  unregisterAll(): void {
    this.clearHintState();
    for (const prefix of this.activePrefixes.keys()) {
      this.deactivatePrefix(prefix);
    }
    for (const prefix of this.actionIdsByPrefix.keys()) {
      this.backend.unregisterShortcut(this.getPrefixRegistrationId(prefix));
    }
    this.actionsById.clear();
    this.actionIdsByPrefix.clear();
    this.inputService.cancel("unregister_all");
  }

  private syncPendingRegistrations(): void {
    const hint = this.inputService.getHintModel();
    const pendingPrefix = hint?.prefix ?? null;

    for (const prefix of [...this.activePrefixes.keys()]) {
      if (prefix !== pendingPrefix) {
        this.deactivatePrefix(prefix);
      }
    }

    if (!pendingPrefix || this.activePrefixes.has(pendingPrefix)) {
      return;
    }

    const sourceHwnd = this.inputService.getState().source;
    const suffixIds: string[] = [];

    for (const actionId of this.actionIdsByPrefix.get(pendingPrefix) ?? []) {
      const action = this.actionsById.get(actionId);
      if (!action) continue;

      const registrationId = this.getSuffixRegistrationId(action.actionId);
      const ok = this.backend.registerShortcut(
        { id: registrationId, accelerator: action.suffix },
        () => {
          const resolution = this.inputService.handlePendingTrigger(action.suffix);
          if (resolution.kind !== "matched") return;
          this.deactivatePrefix(action.prefix);
          void this.invokeAction(action, sourceHwnd);
        },
      );
      if (ok) {
        suffixIds.push(registrationId);
      } else {
        log.warn("assistant_input.suffix_register_failed", {
          prefix: action.prefix,
          suffix: action.suffix,
          actionId: action.actionId,
        });
      }
    }

    this.activePrefixes.set(pendingPrefix, {
      sourceHwnd,
      suffixIds,
    });
  }

  private deactivatePrefix(prefix: string): void {
    const active = this.activePrefixes.get(prefix);
    if (!active) return;
    for (const suffixId of active.suffixIds) {
      this.backend.unregisterShortcut(suffixId);
    }
    this.activePrefixes.delete(prefix);
  }

  private syncHint(): void {
    if (this.suppressHintSync) {
      return;
    }

    const hint = this.inputService.getHintModel();
    if (!hint) {
      this.clearHintState();
      return;
    }

    if (this.visibleHintSessionId === hint.sessionId) {
      this.renderHint(hint);
      return;
    }

    if (this.hintTimer !== null) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }

    this.hintCallbacks.hide();
    this.visibleHintSessionId = null;
    this.hintTimer = setTimeout(() => {
      this.hintTimer = null;
      const latest = this.inputService.getHintModel();
      if (!latest || latest.sessionId !== hint.sessionId) return;
      this.visibleHintSessionId = latest.sessionId;
      this.renderHint(latest);
      this.suppressHintSync = true;
      try {
        this.inputService.extendPendingTimeout(this.hintVisibleTimeoutMs);
      } finally {
        this.suppressHintSync = false;
      }
    }, this.hintDelayMs);
  }

  private renderHint(hint: HintModel): void {
    this.hintCallbacks.show(
      hint.prefix,
      hint.entries.map((entry) => ({
        key: entry.key,
        label: entry.title,
      })),
    );
  }

  private clearHintState(): void {
    if (this.hintTimer !== null) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    if (this.visibleHintSessionId !== null) {
      this.hintCallbacks.hide();
      this.visibleHintSessionId = null;
    }
  }

  private async invokeAction(action: RegisteredAction, sourceHwnd: unknown): Promise<void> {
    let preCaptured: CaptureResult | null = null;
    try {
      preCaptured = await captureSelectedText(sourceHwnd);
    } catch {
      preCaptured = null;
    }

    await action.callback(preCaptured ? { preCaptured } : undefined);
  }

  private getPrefixRegistrationId(prefix: string): string {
    return `assistant-prefix:${prefix}`;
  }

  private getSuffixRegistrationId(actionId: string): string {
    return `assistant-suffix:${actionId}`;
  }
}
