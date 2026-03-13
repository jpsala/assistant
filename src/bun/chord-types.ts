export type ChordMatch = {
  prefix: string;
  suffix: string;
  actionId: string;
  label: string;
};

export type ChordHintEntry = {
  suffix: string;
  label: string;
  actionId: string;
};

export type PendingChordState<TWindow = unknown> = {
  sessionId: number;
  prefix: string;
  sourceHwnd: TWindow;
  startedAt: number;
  deadlineAt: number;
  entries: ChordHintEntry[];
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

export type ChordCancelReason =
  | "cancelled"
  | "escape"
  | "timeout"
  | "invalid-key"
  | "replaced"
  | "empty-prefix";

export type ChordResolution<TWindow = unknown> =
  | { kind: "ignored"; reason: "idle" | "key-up" | "repeat" }
  | { kind: "matched"; match: ChordMatch; pending: PendingChordState<TWindow> }
  | { kind: "cancelled"; reason: ChordCancelReason; pending: PendingChordState<TWindow>; key?: string };

export interface ChordService<TWindow = unknown> {
  registerChord(match: ChordMatch): void;
  unregisterChord(actionId: string): void;
  beginPrefix(prefix: string, sourceHwnd: TWindow): void;
  handleKeyEvent(event: KeyEvent): ChordResolution<TWindow>;
  cancel(reason?: string): void;
  getPendingState(): PendingChordState<TWindow> | null;
}
