import type { BrowserWindow } from "electrobun/bun";
import { createLogger } from "./logger";
import { getSettings, saveSettings, type Settings } from "./settings";

const log = createLogger("window-state");

type WindowKey = keyof Settings["windows"];
type WindowBounds = Settings["windows"][WindowKey];

const MIN_SIZE: Record<WindowKey, { w: number; h: number }> = {
  chat: { w: 520, h: 420 },
  picker: { w: 520, h: 360 },
  settings: { w: 640, h: 520 },
  editor: { w: 680, h: 560 },
};

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

export function getWindowFrame(key: WindowKey): WindowBounds {
  const settings = getSettings();
  const fallback = settings.windows[key];
  return normalizeFrame(key, fallback, fallback);
}

export function bindWindowStatePersistence(
  window: BrowserWindow,
  key: WindowKey,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const persist = async () => {
    try {
      const frame = window.getFrame();
      const next = normalizeFrame(
        key,
        {
          x: frame.x,
          y: frame.y,
          w: frame.width,
          h: frame.height,
        },
        getWindowFrame(key),
      );
      await saveSettings({
        windows: {
          ...getSettings().windows,
          [key]: next,
        },
      });
      log.debug("frame.saved", { key, frame: next });
    } catch (error) {
      log.warn("frame.save_failed", { key, error });
    }
  };

  const schedulePersist = () => {
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
    void persist();
  });
}
