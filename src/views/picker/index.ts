/**
 * Prompt Picker — webview side
 */

import { Electroview } from "electrobun/view";
import type { ElectrobunRPCSchema } from "electrobun/view";
import { mountWindowShell } from "../framework/window-shell";

declare global {
  interface Window {
    __PICKER_PROMPTS__?: PromptInfo[];
    __PICKER_PORT__?: number;
  }
}

export type PromptInfo = {
  name: string;
  displayName: string;
  category: string;
  hotkey?: string;
};

interface PickerSchema extends ElectrobunRPCSchema {
  bun: {
    requests: Record<string, never>;
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      "set-prompts": { prompts: PromptInfo[] };
    };
  };
}

let allPrompts: PromptInfo[] = window.__PICKER_PROMPTS__ ?? [];
let selectedIndex = 0;
const PORT = window.__PICKER_PORT__;

const shell = mountWindowShell({
  title: "Prompt Picker",
  subtitle: "quick run",
  showIcon: true,
  showActionBar: true,
  showStatusBar: true,
  minWidth: 520,
  minHeight: 360,
});

const style = document.createElement("style");
style.textContent = `
  .picker-root {
    min-height: 0;
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 12px;
  }
  .picker-search {
    position: relative;
  }
  .picker-search::before {
    content: "⌕";
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: rgba(255, 255, 255, 0.3);
    font-size: 18px;
    pointer-events: none;
  }
  #search {
    width: 100%;
    background: color-mix(in srgb, var(--ws-bg-muted) 84%, transparent 16%);
    border: 1px solid color-mix(in srgb, var(--ws-border) 76%, transparent 24%);
    border-radius: 10px;
    color: #fff;
    font-size: 16px;
    padding: 9px 12px 9px 36px;
    outline: none;
  }
  #search:focus {
    border-color: color-mix(in srgb, var(--ws-accent) 70%, white 30%);
  }
  .picker-list-shell {
    min-height: 0;
    overflow: hidden;
    display: grid;
    border: 1px solid var(--ws-border);
    border-radius: 14px;
    background: color-mix(in srgb, var(--ws-bg-elevated) 84%, var(--ws-bg) 16%);
  }
  #list {
    overflow-y: auto;
    padding: 6px 0;
    min-height: 0;
  }
  #empty {
    display: grid;
    place-items: center;
    text-align: center;
    color: rgba(255, 255, 255, 0.25);
    padding: 48px 24px;
    font-size: 14px;
    line-height: 1.6;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 16px;
    cursor: pointer;
    border-radius: 8px;
    margin: 1px 6px;
    transition: background 0.1s;
  }
  .item:hover {
    background: rgba(0, 122, 204, 0.18);
  }
  .item.selected {
    background: rgba(0, 122, 204, 0.34);
  }
  .item-name {
    flex: 1;
    font-size: 14px;
    font-weight: 500;
    color: #e8e8f8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-category {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.45);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .item-hotkey {
    font-size: 11px;
    font-family: Consolas, "Fira Mono", monospace;
    color: rgba(255, 255, 255, 0.28);
    white-space: nowrap;
    flex-shrink: 0;
  }
  #busy {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(9, 11, 20, 0.58);
    backdrop-filter: blur(16px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.16s ease;
  }
  #busy.visible {
    opacity: 1;
  }
  .busy-card {
    width: min(420px, calc(100vw - 36px));
    padding: 18px 18px 16px;
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: radial-gradient(circle at top right, rgba(0, 122, 204, 0.2), transparent 34%), rgba(10, 14, 28, 0.82);
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.34);
  }
  .busy-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(225, 232, 255, 0.8);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .busy-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--ws-accent);
    box-shadow: 0 0 14px rgba(0, 122, 204, 0.8);
    animation: pulse 1s ease-in-out infinite;
  }
  .busy-title {
    margin-top: 14px;
    color: #f5f7ff;
    font-size: 18px;
    font-weight: 700;
  }
  .busy-meta {
    margin-top: 6px;
    color: rgba(220, 227, 247, 0.68);
    font-size: 13px;
  }
  .busy-bar {
    margin-top: 16px;
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .busy-bar::after {
    content: "";
    display: block;
    width: 34%;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, rgba(0, 122, 204, 0.2), var(--ws-accent), rgba(255, 255, 255, 0.24));
    animation: sweep 1.15s ease-in-out infinite;
  }
  .picker-actionbar {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .picker-button {
    border: 1px solid color-mix(in srgb, var(--ws-border) 74%, transparent 26%);
    background: color-mix(in srgb, var(--ws-bg-muted) 84%, transparent 16%);
    color: #eef2ff;
    border-radius: 9px;
    padding: 8px 12px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .picker-button.primary {
    background: var(--ws-accent);
    border-color: var(--ws-accent);
  }
  .picker-button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 0.72; }
    50% { transform: scale(1.18); opacity: 1; }
  }
  @keyframes sweep {
    0% { transform: translateX(-18%); }
    50% { transform: translateX(205%); }
    100% { transform: translateX(-18%); }
  }
`;
document.head.appendChild(style);

shell.content.innerHTML = `
  <div class="picker-root">
    <div class="picker-search">
      <input
        id="search"
        type="text"
        placeholder="Search prompts…"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="picker-list-shell">
      <div id="list"></div>
      <div id="empty" style="display:none">No prompts found</div>
    </div>
    <div id="busy" aria-hidden="true">
      <div class="busy-card">
        <div class="busy-chip">
          <span class="busy-dot"></span>
          Processing
        </div>
        <div class="busy-title" id="busy-title">Running prompt</div>
        <div class="busy-meta" id="busy-meta">Capturing selection and sending it to the model</div>
        <div class="busy-bar"></div>
      </div>
    </div>
  </div>
`;

const search = document.getElementById("search") as HTMLInputElement;
const list = document.getElementById("list") as HTMLElement;
const empty = document.getElementById("empty") as HTMLElement;
const busy = document.getElementById("busy") as HTMLElement;
const busyTitle = document.getElementById("busy-title") as HTMLElement;
const busyMeta = document.getElementById("busy-meta") as HTMLElement;

const footerRun = document.createElement("button");
footerRun.className = "picker-button primary";
footerRun.type = "button";
footerRun.textContent = "Run Prompt";

const footerClose = document.createElement("button");
footerClose.className = "picker-button";
footerClose.type = "button";
footerClose.textContent = "Close";

shell.actionbarActions.classList.add("picker-actionbar");
shell.actionbarActions.append(footerClose, footerRun);
shell.actionbarCopy.textContent = "Choose a prompt and run it against the current selection.";
shell.statusLeft.textContent = "Prompt Picker";
shell.statusRight.textContent = "↑↓ Navigate · Enter Run · Esc Close";

let isExecuting = false;

function sendLog(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  meta: Record<string, unknown> = {},
) {
  if (!PORT) return;
  fetch(`http://localhost:${PORT}/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level, event, meta }),
  }).catch(() => {});
}

const rpc = Electroview.defineRPC<PickerSchema>({
  handlers: {
    requests: {},
    messages: {
      "set-prompts": ({ prompts }) => {
        allPrompts = prompts;
        selectedIndex = 0;
        render();
      },
    },
  },
});

new Electroview({ rpc });

function getFiltered(): PromptInfo[] {
  const q = search.value.toLowerCase().trim();
  if (!q) return allPrompts;
  return allPrompts.filter(
    (p) =>
      p.displayName.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q),
  );
}

function render() {
  const filtered = getFiltered();
  list.innerHTML = "";
  empty.style.display = filtered.length ? "none" : "grid";

  selectedIndex = Math.max(0, Math.min(selectedIndex, filtered.length - 1));

  filtered.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "item" + (i === selectedIndex ? " selected" : "");

    const nameEl = document.createElement("span");
    nameEl.className = "item-name";
    nameEl.textContent = p.displayName;

    const catEl = document.createElement("span");
    catEl.className = "item-category";
    catEl.textContent = p.category;

    el.append(nameEl, catEl);

    if (p.hotkey) {
      const hkEl = document.createElement("span");
      hkEl.className = "item-hotkey";
      hkEl.textContent = p.hotkey;
      el.appendChild(hkEl);
    }

    el.addEventListener("click", () => execute(p));
    list.appendChild(el);
  });

  list.querySelector(".item.selected")?.scrollIntoView({ block: "nearest" });
  footerRun.disabled = isExecuting || !filtered[selectedIndex];
  footerClose.disabled = isExecuting;
}

function setBusy(prompt?: PromptInfo) {
  isExecuting = Boolean(prompt);
  busy.classList.toggle("visible", isExecuting);
  search.disabled = isExecuting;
  footerRun.disabled = isExecuting;
  footerClose.disabled = isExecuting;

  if (prompt) {
    busyTitle.textContent = prompt.displayName;
    busyMeta.textContent = "Capturing selection and running prompt";
  } else {
    render();
  }
}

function execute(prompt: PromptInfo) {
  if (isExecuting) return;
  if (!PORT) {
    sendLog("error", "execute_missing_port", { promptName: prompt.name });
    return;
  }
  sendLog("info", "execute_clicked", { promptName: prompt.name });
  setBusy(prompt);
  requestAnimationFrame(() => {
    setTimeout(() => {
      fetch(`http://localhost:${PORT}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: prompt.name }),
      }).then(() => {
        sendLog("info", "execute_posted", { promptName: prompt.name });
      }).catch((err) => {
        sendLog("error", "execute_post_failed", {
          promptName: prompt.name,
          error: err instanceof Error ? err.message : String(err),
        });
        setBusy();
      });
    }, 120);
  });
}

function close() {
  if (isExecuting) return;
  search.value = "";
  selectedIndex = 0;
  render();
  if (!PORT) return;
  sendLog("info", "close_requested");
  fetch(`http://localhost:${PORT}/close`, { method: "POST" }).catch((err) => {
    sendLog("error", "close_post_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

function runSelected() {
  const filtered = getFiltered();
  const selected = filtered[selectedIndex];
  if (selected) execute(selected);
}

search.addEventListener("keydown", (e) => {
  const filtered = getFiltered();
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
      render();
      break;
    case "ArrowUp":
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      render();
      break;
    case "Enter":
      if (filtered[selectedIndex]) execute(filtered[selectedIndex]);
      break;
    case "Escape":
      close();
      break;
  }
});

search.addEventListener("input", () => {
  selectedIndex = 0;
  render();
});

footerClose.addEventListener("click", close);
footerRun.addEventListener("click", runSelected);

render();
sendLog("info", "booted", { promptCount: allPrompts.length });

function ensureFocus(retries = 30) {
  search.focus();
  if (document.activeElement !== search && retries > 0) {
    setTimeout(() => ensureFocus(retries - 1), 50);
  } else if (document.activeElement === search) {
    sendLog("debug", "focus_ready");
  }
}
ensureFocus();
