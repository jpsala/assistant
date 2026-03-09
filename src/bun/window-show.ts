import type { BrowserWindow } from "electrobun/bun";
type LoggerLike = {
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
};

export function showWindowWhenReady(
  window: BrowserWindow,
  log: LoggerLike,
  scope: string,
  afterShow?: () => void,
): void {
  let shown = false;

  const reveal = (reason: string) => {
    if (shown) return;
    shown = true;
    try {
      window.show();
      log.info(`${scope}.revealed`, { reason });
      afterShow?.();
    } catch (error) {
      log.warn(`${scope}.reveal_failed`, { reason, error });
    }
  };

  try {
    window.webview.on("dom-ready", () => reveal("dom-ready"));
  } catch (error) {
    log.warn(`${scope}.dom_ready_hook_failed`, { error });
  }

  setTimeout(() => reveal("fallback"), 700);
}
