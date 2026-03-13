export type ActionId = string;
export type ModeId = string;

export type ActionDefinition = {
  id: ActionId;
  title: string;
};

export type SingleTrigger = {
  kind: "single";
  accelerator: string;
  actionId: ActionId;
};

export type ChordTrigger = {
  kind: "chord";
  prefix: string;
  suffix: string;
  actionId: ActionId;
};

export type ModeEntry = {
  key: string;
  title: string;
  actionId: ActionId;
};

export type ModeDefinition = {
  id: ModeId;
  title: string;
  prefix: string;
  entries: ModeEntry[];
  timeoutMs?: number;
};

export type KeyEvent = {
  type: "down" | "up";
  key: string;
  code?: string;
  alt?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  repeat?: boolean;
  timestamp?: number;
};

export type PendingEntry = {
  key: string;
  accelerator: string;
  title: string;
  actionId: ActionId;
};

export type InputIgnoredReason =
  | "idle"
  | "key-up"
  | "repeat"
  | "no-trigger"
  | "empty-prefix"
  | "suspended";

export type InputCancelReason =
  | "cancelled"
  | "escape"
  | "timeout"
  | "invalid-key"
  | "replaced"
  | "empty-prefix";

export type InputResolution<TSource = unknown> =
  | { kind: "ignored"; reason: InputIgnoredReason }
  | {
      kind: "pending-started";
      sessionId: number;
      prefix: string;
      modeId: ModeId | null;
      entries: PendingEntry[];
      source: TSource | null;
    }
  | {
      kind: "matched";
      actionId: ActionId;
      trigger: "single" | "pending";
      accelerator?: string;
      pendingSessionId?: number;
      source: TSource | null;
    }
  | {
      kind: "cancelled";
      reason: InputCancelReason;
      sessionId: number;
      prefix: string;
      modeId: ModeId | null;
      key?: string;
      source: TSource | null;
    };

export type InputServiceTimer = {
  cancel(): void;
};

export type InputServiceScheduler = {
  now(): number;
  setTimeout(cb: () => void, delayMs: number): InputServiceTimer;
};
