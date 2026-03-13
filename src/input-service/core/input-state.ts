import type {
  ActionId,
  InputResolution,
  ModeId,
  PendingEntry,
} from "./input-types";

export type InputStatus = "idle" | "pending" | "executing" | "suspended";

export type InputState<TSource = unknown> = {
  status: InputStatus;
  sessionId: number | null;
  prefix: string | null;
  modeId: ModeId | null;
  source: TSource | null;
  startedAt: number | null;
  deadlineAt: number | null;
  entries: PendingEntry[];
  activeActionId: ActionId | null;
  lastResolution: InputResolution<TSource> | null;
};

export function createIdleState<TSource = unknown>(): InputState<TSource> {
  return {
    status: "idle",
    sessionId: null,
    prefix: null,
    modeId: null,
    source: null,
    startedAt: null,
    deadlineAt: null,
    entries: [],
    activeActionId: null,
    lastResolution: null,
  };
}

export function cloneState<TSource>(state: InputState<TSource>): InputState<TSource> {
  return {
    ...state,
    entries: state.entries.map((entry) => ({ ...entry })),
    lastResolution: state.lastResolution ? cloneResolution(state.lastResolution) : null,
  };
}

function cloneResolution<TSource>(resolution: InputResolution<TSource>): InputResolution<TSource> {
  switch (resolution.kind) {
    case "pending-started":
      return {
        ...resolution,
        entries: resolution.entries.map((entry) => ({ ...entry })),
      };
    default:
      return { ...resolution };
  }
}
