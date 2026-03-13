import type { BrowserWindow } from "electrobun/bun";
import { createLogger } from "./logger";
import { getSettings, saveSettings, type Settings } from "./settings";
import { getScreenSize } from "./ffi";

const log = createLogger("window-state");

export type WindowKey = keyof Settings["windows"];
type WindowBounds = Settings["windows"][WindowKey];
export type WindowFrame = WindowBounds;
export type WindowPersistenceOptions = {
  persistPosition?: boolean;
  persistSize?: boolean;
};

const MIN_SIZE: Record<WindowKey, { w: number; h: number }> = {
  chat: { w: 520, h: 420 },
  picker: { w: 520, h: 360 },
  settings: { w: 640, h: 520 },
  editor: { w: 680, h: 560 },
  lab: { w: 560, h: 380 },
};

const SCREEN_MARGIN = 48;

function normalizeFrame(key: WindowKey, frame: Partial<WindowBounds>, fallback: WindowBounds): WindowBounds {
  const min = MIN_SIZE[key];
  const x = Number.isFinite(frame.x) ? Number(frame.x) : fallback.x;
  const y = Number.isFinite(frame.y) ? Number(frame.y) : fallback.y;
  const w = Number.isFinite(frame.w) ? Number(frame.w) : fallback.w;
  const h = Number.isFinite(frame.h) ? Number(frame.h) : fallback.h;

  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.max(min.w, Math.round(w)),
    h: Math.max(min.h, Math.round(h)),
  };
}

function isDefaultPosition(key: WindowKey, frame: WindowBounds): boolean {
  const defaults: Record<WindowKey, { x: number; y: number }> = {
    chat: { x: 220, y: 120 },
    picker: { x: 320, y: 180 },
    settings: { x: 360, y: 120 },
    editor: { x: 280, y: 80 },
    lab: { x: 420, y: 140 },
  };
  const def = defaults[key];
  return frame.x === def.x && frame.y === def.y;
}

function getCenteredPosition(width: number, height: number): { x: number; y: number } {
  const screen = getScreenSize();
  return {
    x: Math.round((screen.width - width) / 2),
    y: Math.round((screen.height - height) / 2),
  };
}

function constrainSizeToScreen(key: WindowKey, frame: WindowBounds): WindowBounds {
  const screen = getScreenSize();
  const min = MIN_SIZE[key];
  const maxWidth = Math.max(min.w, screen.width - SCREEN_MARGIN * 2);
  const maxHeight = Math.max(min.h, screen.height - SCREEN_MARGIN * 2);
  return {
    ...frame,
    w: Math.max(min.w, Math.min(frame.w, maxWidth)),
    h: Math.max(min.h, Math.min(frame.h, maxHeight)),
  };
}

function isFrameOffScreen(frame: WindowBounds): boolean {
  const screen = getScreenSize();
  const visibleRight = frame.x + Math.min(frame.w, 160);
  const visibleBottom = frame.y + Math.min(frame.h, 120);
  return (
    visibleRight < 0 ||
    visibleBottom < 0 ||
    frame.x > screen.width - 80 ||
    frame.y > screen.height - 80
  );
}

export function getWindowFrame(key: WindowKey): WindowBounds {
  const settings = getSettings();
  const fallback = settings.windows[key];
  const normalized = constrainSizeToScreen(key, normalizeFrame(key, fallback, fallback));
  if (isDefaultPosition(key, normalized) || isFrameOffScreen(normalized)) {
    const centered = getCenteredPosition(normalized.w, normalized.h);
    return {
      ...normalized,
      x: centered.x,
      y: centered.y,
    };
  }
  return normalized;
}

export function bindWindowStatePersistence(
  window: BrowserWindow,
  key: WindowKey,
  options: WindowPersistenceOptions = {},
): void {
  const persistPosition = options.persistPosition ?? true;
  const persistSize = options.persistSize ?? true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastObservedFrame: WindowBounds | null = null;

  const captureFrame = (): WindowBounds => {
    const frame = window.getFrame();
    const current = getSettings().windows[key];
    return normalizeFrame(
      key,
      {
        x: persistPosition ? frame.x : current.x,
        y: persistPosition ? frame.y : current.y,
        w: persistSize ? frame.width : current.w,
        h: persistSize ? frame.height : current.h,
      },
      current,
    );
  };

  const persist = async (frameOverride?: WindowBounds | null) => {
    try {
      const next = frameOverride ?? captureFrame();
      lastObservedFrame = next;
      await saveSettings({
        windows: {
          ...getSettings().windows,
          [key]: next,
        },
      });
      log.debug("frame.saved", { key, frame: next, persistPosition, persistSize });
    } catch (error) {
      log.warn("frame.save_failed", { key, error });
    }
  };

  const schedulePersist = () => {
    try {
      lastObservedFrame = captureFrame();
    } catch {}
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void persist();
    }, 180);
  };

  window.on("move", schedulePersist);
  window.on("resize", schedulePersist);
  window.on("close", () => {
    if (timer) clearTimeout(timer);
    void persist(lastObservedFrame);
  });
}
