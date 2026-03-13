import type { ModeId, PendingEntry } from "./input-types";
import type { InputState } from "./input-state";

export type HintModel = {
  sessionId: number;
  prefix: string;
  modeId: ModeId | null;
  entries: PendingEntry[];
  startedAt: number;
  deadlineAt: number;
};

export function buildHintModel<TSource>(state: InputState<TSource>): HintModel | null {
  if (state.status !== "pending") return null;
  if (state.sessionId === null || state.prefix === null || state.startedAt === null || state.deadlineAt === null) {
    return null;
  }

  return {
    sessionId: state.sessionId,
    prefix: state.prefix,
    modeId: state.modeId,
    entries: state.entries.map((entry) => ({ ...entry })),
    startedAt: state.startedAt,
    deadlineAt: state.deadlineAt,
  };
}
