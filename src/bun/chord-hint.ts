import { BrowserWindow } from "electrobun/bun";
import { getScreenSize } from "./ffi";
import { createLogger } from "./logger";

const log = createLogger("chord-hint");

let hintWindow: BrowserWindow | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let port: number | null = null;

let activePrefix = "";
let activeEntries: { key: string; label: string }[] = [];

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtml(): string {
  const rows = [...activeEntries]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ key, label }) => `<div class="row"><kbd>${esc(key)}</kbd><span>${esc(label)}</span></div>`)
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: transparent; height: 100%; }
body { display: flex; align-items: flex-end; }
.hint {
  width: 100%;
  background: rgba(14, 15, 26, 0.97);
  color: #e2e8f0;
  padding: 10px 16px 12px;
  border-radius: 10px;
  border: 1px solid rgba(139, 92, 246, 0.4);
  font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
  font-size: 13px;
}
.header {
  font-size: 11px;
  color: #8b5cf6;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 0;
}
kbd {
  font-family: Consolas, monospace;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 5px;
  background: rgba(139, 92, 246, 0.2);
  border: 1px solid rgba(139, 92, 246, 0.4);
  color: #c4b5fd;
  min-width: 30px;
  text-align: center;
  flex-shrink: 0;
}
span { color: #cbd5e1; }
</style>
</head>
<body><div class="hint">
  <div class="header">${esc(activePrefix)} &rarr;</div>
  ${rows}
</div></body>
</html>`;
}

export async function initChordHint(): Promise<void> {
  if (port !== null) return;
  server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(buildHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
  });
  port = server.port;
  log.info("server.ready", { port });
}

export function showChordHint(prefix: string, entries: { key: string; label: string }[]): void {
  hideChordHint();
  if (port === null || entries.length === 0) return;

  activePrefix = prefix;
  activeEntries = entries;

  const rowHeight = 26;
  const headHeight = 32;
  const paddingY = 22;
  const width = 240;
  const height = paddingY + headHeight + entries.length * rowHeight;
  const screen = getScreenSize();
  const x = Math.round((screen.width - width) / 2);
  const y = screen.height - height - 60;

  hintWindow = new BrowserWindow({
    title: "Chord Hint",
    frame: { x, y, width, height },
    url: `http://localhost:${port}/`,
    html: null,
    titleBarStyle: "hidden",
    transparent: true,
  });
  hintWindow.setAlwaysOnTop(true);
  log.info("hint.shown", { prefix, count: entries.length });
}

export function hideChordHint(): void {
  if (!hintWindow) return;
  try { hintWindow.close(); } catch {}
  hintWindow = null;
  log.info("hint.hidden");
}
