const SHELL_STYLE_ID = "window-shell-styles";

const SHELL_CSS = `
:root {
  color-scheme: dark;
  --ws-bg: #1e1e1e;
  --ws-bg-elevated: #252526;
  --ws-bg-muted: #2d2d30;
  --ws-border: #313131;
  --ws-border-strong: #3c3c3c;
  --ws-text: #cccccc;
  --ws-text-muted: #9d9d9d;
  --ws-accent: #007acc;
}

html[data-theme="light"] {
  color-scheme: light;
  --ws-bg: #f3f3f3;
  --ws-bg-elevated: #ffffff;
  --ws-bg-muted: #f8f8f8;
  --ws-border: #dddddd;
  --ws-border-strong: #cfcfcf;
  --ws-text: #1f1f1f;
  --ws-text-muted: #616161;
  --ws-accent: #005fb8;
}

* { box-sizing: border-box; }

html,
body {
  margin: 0;
  min-height: 100%;
  background: #171717;
  color: var(--ws-text);
  font: 13px/1.4 "Segoe UI", system-ui, sans-serif;
  overflow: hidden;
}

body { min-height: 100vh; }

.ws-hitbox {
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--ws-bg-elevated) 40%, #111 60%), #171717);
  -webkit-app-region: no-drag;
}

.ws-resize-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: none;
  background: rgba(0, 0, 0, 0.01);
  -webkit-app-region: no-drag;
  pointer-events: auto;
}

html[data-resizing="on"] .ws-resize-overlay {
  display: block;
  pointer-events: auto;
}

/* During settle the overlay shows the cursor but passes mouse events through.
   A document-level capture listener blocks accidental content clicks instead. */
html[data-resize-settling="on"] .ws-resize-overlay {
  display: block;
  pointer-events: none;
}

.ws-app {
  position: relative;
  z-index: 1;
  height: 100vh;
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto auto;
  border-radius: 10px;
  overflow: hidden;
  background: var(--ws-bg);
}

.ws-resize-edge,
.ws-resize-corner {
  position: fixed;
  z-index: 50;
  -webkit-app-region: no-drag;
  touch-action: none;
}

.ws-resize-edge.top,
.ws-resize-edge.bottom { left: 10px; right: 10px; height: 4px; }
.ws-resize-edge.top { top: 0; cursor: ns-resize; }
.ws-resize-edge.bottom { bottom: 0; cursor: ns-resize; }
.ws-resize-edge.left,
.ws-resize-edge.right { top: 10px; bottom: 10px; width: 3px; }
.ws-resize-edge.left { left: 0; cursor: ew-resize; }
.ws-resize-edge.right { right: 0; cursor: ew-resize; }

.ws-resize-corner { width: 8px; height: 8px; z-index: 55; }
.ws-resize-corner.top-left { top: 0; left: 0; cursor: nwse-resize; }
.ws-resize-corner.top-right { top: 0; right: 0; cursor: nesw-resize; }
.ws-resize-corner.bottom-left { bottom: 0; left: 0; cursor: nesw-resize; }
.ws-resize-corner.bottom-right { right: 0; bottom: 0; cursor: nwse-resize; }

.ws-topbar {
  height: 30px;
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: stretch;
  gap: 0;
  padding-left: 8px;
  background: color-mix(in srgb, var(--ws-bg-elevated) 90%, var(--ws-bg) 10%);
  border-bottom: 1px solid var(--ws-border);
  cursor: default;
  user-select: none;
}

.ws-title-group {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding-right: 10px;
  overflow: hidden;
  cursor: default;
}

.ws-title-icon-wrap {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 5px;
  background: color-mix(in srgb, var(--ws-bg-muted) 82%, transparent 18%);
  border: 1px solid color-mix(in srgb, var(--ws-border) 80%, transparent 20%);
}

.ws-title-icon { width: 12px; height: 12px; display: block; }
.ws-title-icon .glyph-a { fill: #32a2ff; }
.ws-title-icon .glyph-b { fill: #b483ff; }
html[data-icon="off"] .ws-title-icon-wrap { display: none; }

.ws-title-text {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ws-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.ws-subtitle {
  margin: 0;
  font-size: 10px;
  color: var(--ws-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.9;
}

.ws-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  opacity: 0.72;
  -webkit-app-region: no-drag;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.ws-toolbar:empty { display: none; }

.ws-toolbar-button {
  height: 20px;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--ws-text-muted);
  font: 10px/1 "Segoe UI", system-ui, sans-serif;
  cursor: pointer;
  flex: 0 0 auto;
}

.ws-toolbar-button:hover {
  border-color: var(--ws-border);
  background: var(--ws-bg-muted);
  color: var(--ws-text);
}

.ws-window-controls {
  display: flex;
  align-items: stretch;
  -webkit-app-region: no-drag;
}

.ws-window-control {
  width: 45px;
  border: 0;
  border-left: 1px solid var(--ws-border);
  background: transparent;
  color: var(--ws-text);
  font: 10px/1 "Segoe UI Symbol", "Segoe UI", sans-serif;
  cursor: pointer;
}

.ws-window-control:hover { background: var(--ws-bg-muted); }
.ws-window-control.close:hover { background: #c42b1c; color: white; }
.ws-window-control span { display: inline-block; transform: translateY(-1px); }

.ws-content {
  min-height: 0;
  padding: 18px 14px 14px;
  background: var(--ws-bg);
  overflow: auto;
}

.ws-actionbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--ws-bg-elevated) 88%, var(--ws-bg) 12%);
  border-top: 1px solid var(--ws-border);
}

.ws-actionbar-copy {
  color: var(--ws-text-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ws-actionbar-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.ws-statusbar {
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--ws-bg-elevated) 90%, var(--ws-bg) 10%);
  border-top: 1px solid var(--ws-border);
  color: var(--ws-text-muted);
  font-size: 10px;
}

html[data-actionbar="off"] .ws-actionbar { display: none; }
html[data-statusbar="off"] .ws-statusbar { display: none; }

@media (max-width: 520px) {
  .ws-topbar {
    height: auto;
    grid-template-columns: 1fr;
    padding: 10px 12px;
  }
  .ws-title-text { display: grid; gap: 0; }
  .ws-toolbar {
    justify-content: flex-start;
    flex-wrap: wrap;
    padding: 0;
  }
  .ws-window-controls { display: none; }
  .ws-content { padding: 16px 12px 12px; }
  .ws-actionbar {
    align-items: stretch;
    flex-direction: column;
  }
  .ws-actionbar-actions { justify-content: flex-start; }
}

@media (max-width: 760px) {
  .ws-subtitle { display: none; }
}
`;

export type WindowShellOptions = {
  port?: number;
  resizable?: boolean;
  resizeGrip?: HTMLButtonElement | null;
  minWidth: number;
  minHeight: number;
  onEscape?: () => void;
  closeButton?: HTMLElement | null;
};

type MountWindowShellOptions = {
  title: string;
  subtitle?: string;
  showIcon?: boolean;
  iconSvg?: string;
  showActionBar?: boolean;
  showStatusBar?: boolean;
  minWidth?: number;
  minHeight?: number;
};

type WindowShellRefs = {
  app: HTMLElement;
  content: HTMLElement;
  toolbar: HTMLElement;
  actionbar: HTMLElement;
  actionbarCopy: HTMLElement;
  actionbarActions: HTMLElement;
  statusbar: HTMLElement;
  statusLeft: HTMLElement;
  statusRight: HTMLElement;
  setTitle(title: string): void;
  setSubtitle(subtitle: string): void;
  setTheme(theme: "dark" | "light"): void;
  setIconVisible(visible: boolean): void;
  setActionBarVisible(visible: boolean): void;
  setStatusBarVisible(visible: boolean): void;
};

function ensureStyles(): void {
  if (document.getElementById(SHELL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SHELL_STYLE_ID;
  style.textContent = SHELL_CSS;
  document.head.appendChild(style);
}

async function post(path: string, body?: unknown): Promise<void> {
  await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function mountWindowShell(options: MountWindowShellOptions): WindowShellRefs {
  ensureStyles();

  const root = document.documentElement;
  root.dataset.theme ??= "dark";
  root.dataset.icon = options.showIcon === false ? "off" : "on";
  root.dataset.actionbar = options.showActionBar === false ? "off" : "on";
  root.dataset.statusbar = options.showStatusBar === false ? "off" : "on";
  root.dataset.maximized ??= "off";

  document.body.innerHTML = `
    <div class="ws-resize-edge top" data-resize="top"></div>
    <div class="ws-resize-edge right" data-resize="right"></div>
    <div class="ws-resize-edge bottom" data-resize="bottom"></div>
    <div class="ws-resize-edge left" data-resize="left"></div>
    <div class="ws-resize-corner top-left" data-resize="top-left"></div>
    <div class="ws-resize-corner top-right" data-resize="top-right"></div>
    <div class="ws-resize-corner bottom-left" data-resize="bottom-left"></div>
    <div class="ws-resize-corner bottom-right" data-resize="bottom-right"></div>
    <div class="ws-hitbox" aria-hidden="true"></div>
    <div class="ws-resize-overlay" aria-hidden="true"></div>
    <main class="ws-app">
      <header class="ws-topbar">
        <div class="ws-title-group electrobun-webkit-app-region-drag">
          <span class="ws-title-icon-wrap" aria-hidden="true">
            <svg class="ws-title-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect class="glyph-a" x="1" y="1" width="6" height="6" rx="1.5"></rect>
              <rect class="glyph-b" x="9" y="1" width="6" height="6" rx="1.5"></rect>
              <rect class="glyph-b" x="1" y="9" width="6" height="6" rx="1.5"></rect>
              <rect class="glyph-a" x="9" y="9" width="6" height="6" rx="1.5"></rect>
            </svg>
          </span>
          <div class="ws-title-text">
            <p class="ws-title"></p>
            <p class="ws-subtitle"></p>
          </div>
        </div>
        <div class="ws-toolbar"></div>
        <div class="ws-window-controls" aria-label="Window controls">
          <button class="ws-window-control" data-window-action="minimize" aria-label="Minimize"><span>&#x2212;</span></button>
          <button class="ws-window-control" data-window-action="maximize" aria-label="Maximize"><span>&#x25A1;</span></button>
          <button class="ws-window-control close" data-window-action="close" aria-label="Close"><span>&#x2715;</span></button>
        </div>
      </header>
      <section class="ws-content"></section>
      <section class="ws-actionbar">
        <div class="ws-actionbar-copy"></div>
        <div class="ws-actionbar-actions"></div>
      </section>
      <footer class="ws-statusbar">
        <span class="ws-status-left"></span>
        <span class="ws-status-right"></span>
      </footer>
    </main>
  `;

  const app = document.querySelector(".ws-app") as HTMLElement;
  const content = document.querySelector(".ws-content") as HTMLElement;
  const toolbar = document.querySelector(".ws-toolbar") as HTMLElement;
  const actionbar = document.querySelector(".ws-actionbar") as HTMLElement;
  const actionbarCopy = document.querySelector(".ws-actionbar-copy") as HTMLElement;
  const actionbarActions = document.querySelector(".ws-actionbar-actions") as HTMLElement;
  const statusbar = document.querySelector(".ws-statusbar") as HTMLElement;
  const statusLeft = document.querySelector(".ws-status-left") as HTMLElement;
  const statusRight = document.querySelector(".ws-status-right") as HTMLElement;
  const titleEl = document.querySelector(".ws-title") as HTMLElement;
  const subtitleEl = document.querySelector(".ws-subtitle") as HTMLElement;
  const titleIconWrap = document.querySelector(".ws-title-icon-wrap") as HTMLElement;
  const maximizeButton = document.querySelector('[data-window-action="maximize"]') as HTMLButtonElement;
  const topbar = document.querySelector(".ws-topbar") as HTMLElement;
  const resizeHandles = Array.from(document.querySelectorAll<HTMLElement>("[data-resize]"));
  const resizeOverlay = document.querySelector(".ws-resize-overlay") as HTMLElement;
  const minWidth = options.minWidth ?? 560;
  const minHeight = options.minHeight ?? 380;
  let resizeSettleTimer: ReturnType<typeof setTimeout> | null = null;

  function clearResizeOverlay(): void {
    root.dataset.resizing = "off";
    root.dataset.resizeSettling = "off";
    resizeOverlay.style.cursor = "";
  }

  function settleAfterResize(): void {
    root.dataset.resizing = "off";
    root.dataset.resizeSettling = "on";
    if (resizeSettleTimer) clearTimeout(resizeSettleTimer);
    resizeSettleTimer = setTimeout(() => {
      resizeSettleTimer = null;
      clearResizeOverlay();
    }, 80);
  }

  function syncLabels(): void {
    const maximized = root.dataset.maximized === "on";
    maximizeButton.innerHTML = maximized ? "<span>&#x2750;</span>" : "<span>&#x25A1;</span>";
    maximizeButton.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
    maximizeButton.setAttribute("title", maximized ? "Restore" : "Maximize");
  }

  async function syncWindowState(): Promise<void> {
    try {
      const response = await fetch("/window/state");
      const state = await response.json() as { maximized?: boolean };
      root.dataset.maximized = state.maximized ? "on" : "off";
      syncLabels();
    } catch {}
  }

  function clampFrame(frame: { x: number; y: number; width: number; height: number }) {
    return {
      x: Math.round(frame.x),
      y: Math.round(frame.y),
      width: Math.max(minWidth, Math.round(frame.width)),
      height: Math.max(minHeight, Math.round(frame.height)),
    };
  }

  function installResizeHandle(handle: HTMLElement): void {
    const direction = handle.dataset.resize;
    if (!direction) return;

    // Pre-fetch the frame on hover so pointerdown has no async gap.
    // mouseenter has the same implicit OS capture guarantee as mousedown on document.
    let cachedFrame: { x: number; y: number; width: number; height: number } | null = null;
    handle.addEventListener("mouseenter", () => {
      fetch("/window/frame")
        .then((r) => r.json())
        .then((f) => { cachedFrame = f as { x: number; y: number; width: number; height: number }; })
        .catch(() => {});
    });

    handle.addEventListener("mousedown", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // Cancel any ongoing settle so its timer doesn't clear the new drag state.
      if (resizeSettleTimer) { clearTimeout(resizeSettleTimer); resizeSettleTimer = null; }
      root.dataset.resizeSettling = "off";
      root.dataset.resizing = "on";
      resizeOverlay.style.cursor = getComputedStyle(handle).cursor;

      const startMouse = { x: event.screenX, y: event.screenY };
      // Use cached frame from hover; fall back to a fresh fetch only if cache is cold.
      // The fallback is best-effort — in practice the hover always resolves first.
      const startFrame = cachedFrame ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };

      const onMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.screenX - startMouse.x;
        const dy = moveEvent.screenY - startMouse.y;
        let next = { ...startFrame };
        if (direction.includes("right")) next.width = startFrame.width + dx;
        if (direction.includes("left")) {
          next.x = startFrame.x + dx;
          next.width = startFrame.width - dx;
        }
        if (direction.includes("bottom")) next.height = startFrame.height + dy;
        if (direction.includes("top")) {
          next.y = startFrame.y + dy;
          next.height = startFrame.height - dy;
        }
        if (next.width < minWidth && direction.includes("left")) next.x -= minWidth - next.width;
        if (next.height < minHeight && direction.includes("top")) next.y -= minHeight - next.height;
        void post("/window/frame", clampFrame(next));
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        // Must match the { capture: true } used when adding.
        document.removeEventListener("mouseup", onUp, { capture: true });
        // Refresh cached frame for the next drag.
        fetch("/window/frame")
          .then((r) => r.json())
          .then((f) => { cachedFrame = f as { x: number; y: number; width: number; height: number }; })
          .catch(() => {});
        settleAfterResize();
        void post("/window/focus");
      };

      // document-level listeners have implicit OS mouse capture: events keep
      // arriving even when the cursor exits the WebView or the OS window.
      // mouseup uses capture phase so the resize overlay's stopPropagation
      // cannot block it — onUp must always fire to clean up the drag state.
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp, { capture: true });
    });
  }

  // During active resize the overlay is pointer-events:auto and swallows clicks
  // so they don't reach content behind it.
  ["mousedown", "mouseup", "click"].forEach((eventName) => {
    resizeOverlay.addEventListener(eventName, (event) => {
      if (root.dataset.resizing !== "on") return;
      event.preventDefault();
      event.stopPropagation();
    });
  });

  // During settle the overlay is pointer-events:none so resize handles are
  // reachable. Block accidental content clicks at the capture phase instead.
  document.addEventListener("mousedown", (event) => {
    if (root.dataset.resizeSettling !== "on") return;
    const target = event.target as Element | null;
    if (target?.closest("[data-resize]")) return; // allow resize handles
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });

  document.querySelector('[data-window-action="minimize"]')?.addEventListener("click", () => { void post("/window/minimize"); });
  maximizeButton.addEventListener("click", async () => {
    await post("/window/maximize-toggle");
    await syncWindowState();
  });
  document.querySelector('[data-window-action="close"]')?.addEventListener("click", () => { void post("/close"); });

  topbar.addEventListener("dblclick", async (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".ws-toolbar, .ws-window-controls")) return;
    await post("/window/maximize-toggle");
    await syncWindowState();
  });

  window.addEventListener("resize", () => { void syncWindowState(); });
  resizeHandles.forEach(installResizeHandle);

  titleEl.textContent = options.title;
  subtitleEl.textContent = options.subtitle ?? "";
  if (options.iconSvg) {
    titleIconWrap.innerHTML = options.iconSvg;
  }
  syncLabels();
  void syncWindowState();

  return {
    app,
    content,
    toolbar,
    actionbar,
    actionbarCopy,
    actionbarActions,
    statusbar,
    statusLeft,
    statusRight,
    setTitle(title: string) { titleEl.textContent = title; },
    setSubtitle(subtitle: string) { subtitleEl.textContent = subtitle; },
    setTheme(theme: "dark" | "light") { root.dataset.theme = theme; },
    setIconVisible(visible: boolean) { root.dataset.icon = visible ? "on" : "off"; },
    setActionBarVisible(visible: boolean) { root.dataset.actionbar = visible ? "on" : "off"; },
    setStatusBarVisible(visible: boolean) { root.dataset.statusbar = visible ? "on" : "off"; },
  };
}

export function postWindowMessage(
  port: number | undefined,
  path: string,
  body?: Record<string, unknown>,
): Promise<Response | void> {
  if (!port) return Promise.resolve();
  return fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {});
}

export function sendWindowLog(
  port: number | undefined,
  level: "debug" | "info" | "warn" | "error",
  event: string,
  meta: Record<string, unknown> = {},
): void {
  void postWindowMessage(port, "/log", { level, event, meta });
}

export function bindWindowShell(options: WindowShellOptions): void {
  const {
    port,
    resizable = true,
    resizeGrip,
    minWidth,
    minHeight,
    onEscape,
    closeButton,
  } = options;

  closeButton?.addEventListener("click", () => {
    void postWindowMessage(port, "/close");
  });

  if (resizeGrip) {
    if (!port || !resizable) {
      resizeGrip.hidden = true;
    } else {
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startWidth = 0;
      let startHeight = 0;

      const onMove = (event: MouseEvent) => {
        if (!dragging) return;
        const width = Math.max(minWidth, Math.round(startWidth + (event.clientX - startX)));
        const height = Math.max(minHeight, Math.round(startHeight + (event.clientY - startY)));
        void postWindowMessage(port, "/window/resize", { width, height });
      };

      const onUp = () => {
        dragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      resizeGrip.addEventListener("mousedown", (event) => {
        event.preventDefault();
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        startWidth = window.innerWidth;
        startHeight = window.innerHeight;
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }
  }

  if (onEscape) {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") onEscape();
    });
  }
}
