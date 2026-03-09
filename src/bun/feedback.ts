import { BrowserWindow } from "electrobun/bun";
import type { ReplaceStatus } from "./replace";
import { forceFocus, getScreenSize } from "./ffi";
import { createLogger } from "./logger";

type ToastKind = "progress" | "success" | "error";

const log = createLogger("feedback");
let toastWindow: BrowserWindow | null = null;
let closeTimer: Timer | null = null;
let toastServer: ReturnType<typeof Bun.serve> | null = null;
let toastPort: number | null = null;
const TOAST_WIDTH = 360;
const TOAST_HEIGHT = 112;

function getToastFrame(visible: boolean): { x: number; y: number; width: number; height: number } {
  const screen = getScreenSize();
  const x = visible ? Math.max(12, screen.width - TOAST_WIDTH - 24) : screen.width + 64;
  const y = visible ? 24 : 24;
  return { x, y, width: TOAST_WIDTH, height: TOAST_HEIGHT };
}

function renderToastHtml(kind: ToastKind, title: string, detail: string): string {
  const accent = kind === "success" ? "#3ddc97" : kind === "error" ? "#ff6b6b" : "#4cc9f0";
  const glow = kind === "success"
    ? "rgba(61, 220, 151, 0.24)"
    : kind === "error"
      ? "rgba(255, 107, 107, 0.26)"
      : "rgba(76, 201, 240, 0.24)";
  const badge = kind === "success" ? "Applied" : kind === "error" ? "Attention" : "Working";
  const icon = kind === "success" ? "✓" : kind === "error" ? "!" : "···";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Assistant Feedback</title>
    <style>
      :root {
        --accent: ${accent};
        --glow: ${glow};
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html, body {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background:
          radial-gradient(circle at top left, rgba(255, 255, 255, 0.09), transparent 48%),
          linear-gradient(135deg, rgba(13, 18, 33, 0.96), rgba(8, 10, 20, 0.92));
        color: #eef2ff;
        font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
      }
      body { padding: 12px; }
      .toast {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(10, 14, 27, 0.96);
        box-shadow:
          0 18px 36px rgba(0, 0, 0, 0.38),
          0 0 0 1px rgba(255, 255, 255, 0.03) inset;
        overflow: hidden;
      }
      .toast::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at top right, var(--glow), transparent 34%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 38%);
        pointer-events: none;
      }
      .rail {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background: linear-gradient(180deg, var(--accent), rgba(255, 255, 255, 0.25));
      }
      .content {
        position: relative;
        display: grid;
        grid-template-columns: 42px 1fr;
        gap: 12px;
        padding: 16px 18px 16px 20px;
        height: 100%;
        align-items: center;
      }
      .icon {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
        font-size: 18px;
      }
      .meta { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
      .badge {
        width: fit-content;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent);
        background: rgba(255, 255, 255, 0.05);
      }
      .title {
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
        color: #f8faff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .detail {
        font-size: 12px;
        line-height: 1.45;
        color: rgba(226, 232, 240, 0.74);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .progress {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 3px;
        background: rgba(255, 255, 255, 0.06);
        overflow: hidden;
      }
      .progress::after {
        content: "";
        display: block;
        width: ${kind === "progress" ? "34%" : "100%"};
        height: 100%;
        transform-origin: left center;
        background: linear-gradient(90deg, var(--accent), rgba(255, 255, 255, 0.2));
        animation: ${kind === "progress" ? "slide 1.1s ease-in-out infinite" : "shrink 2.8s linear forwards"};
      }
      @keyframes shrink {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }
      @keyframes slide {
        0% { transform: translateX(-20%); }
        50% { transform: translateX(205%); }
        100% { transform: translateX(-20%); }
      }
    </style>
  </head>
  <body>
    <div class="toast">
      <div class="rail"></div>
      <div class="content">
        <div class="icon">${icon}</div>
        <div class="meta">
          <div class="badge">${title}</div>
          <div class="title">${detail}</div>
          <div class="detail">Assistant is working in the background.</div>
        </div>
      </div>
      <div class="progress"></div>
    </div>
  </body>
</html>`;
}

async function ensureToastServer(): Promise<number> {
  if (toastPort !== null) return toastPort;

  toastServer = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/" && url.pathname !== "/index.html") {
        return new Response("Not found", { status: 404 });
      }

      const kind = (url.searchParams.get("kind") as ToastKind | null) ?? "progress";
      const title = url.searchParams.get("title") ?? "Working";
      const detail = url.searchParams.get("detail") ?? "Assistant is processing your request";

      return new Response(renderToastHtml(kind, title, detail), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });

  toastPort = toastServer.port;
  log.info("server.ready", { port: toastPort });
  return toastPort;
}

function closeToast(): void {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (!toastWindow) return;
  try {
    toastWindow.close();
  } catch {}
  toastWindow = null;
}

async function showToast(kind: ToastKind, title: string, detail: string): Promise<void> {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  log.info("toast.show", { kind, title, detail });
  const port = await ensureToastServer();
  const url = `http://localhost:${port}/?kind=${encodeURIComponent(kind)}&title=${encodeURIComponent(title)}&detail=${encodeURIComponent(detail)}`;
  const frame = getToastFrame(true);

  if (!toastWindow) {
    toastWindow = new BrowserWindow({
      title: "Assistant Feedback",
      frame,
      html: null,
      url,
      titleBarStyle: "hidden",
      transparent: false,
    });

    toastWindow.setAlwaysOnTop(true);
    toastWindow.show();
  } else {
    toastWindow.setFrame(frame.x, frame.y, frame.width, frame.height);
    toastWindow.webview.loadURL(url);
    toastWindow.show();
  }

  if (kind !== "progress") {
    closeTimer = setTimeout(() => {
      closeToast();
    }, kind === "success" ? 2800 : 4200);
  }
}

function trimErrorMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

export function handleReplaceStatus(status: ReplaceStatus): void {
  log.info("status.received", status);
  if (status.stage === "capturing") {
    return;
  }

  if (status.stage === "processing") {
    void showToast("progress", "Processing with model", `${status.promptName} · ${status.model}`);
    if (status.hwnd) forceFocus(status.hwnd);
    return;
  }

  if (status.stage === "pasting") {
    void showToast("progress", "Applying result", status.promptName);
    if (status.hwnd) forceFocus(status.hwnd);
    return;
  }

  if (status.stage === "success") {
    const detail = status.model
      ? `${status.promptName} · ${status.model}`
      : status.promptName;
    void showToast("success", "Text updated", detail);
    if (status.hwnd) forceFocus(status.hwnd);
    return;
  }

  if (status.stage === "error") {
    void showToast(
      "error",
      `Could not run ${status.promptName}`,
      trimErrorMessage(status.detail),
    );
    if (status.hwnd) forceFocus(status.hwnd);
  }
}
