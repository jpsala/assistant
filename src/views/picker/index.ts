/**
 * Prompt Picker — webview side
 *
 * Initial prompts are injected by the server as window.__PICKER_PROMPTS__.
 * Actions (execute, close) are sent via fetch to the local server.
 * Live prompt updates arrive via the "set-prompts" RPC message (best-effort).
 */

import { Electroview } from "electrobun/view";
import type { ElectrobunRPCSchema } from "electrobun/view";

declare global {
  interface Window {
    __PICKER_PROMPTS__?: PromptInfo[];
    __PICKER_PORT__?: number;
    __PICKER_RESIZABLE__?: boolean;
  }
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export type PromptInfo = {
  name: string;
  displayName: string;
  category: string;
  hotkey?: string;
};

// ─── RPC schema (best-effort live updates) ────────────────────────────────────

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

// ─── State ───────────────────────────────────────────────────────────────────

let allPrompts: PromptInfo[] = window.__PICKER_PROMPTS__ ?? [];
let selectedIndex = 0;
const PORT = window.__PICKER_PORT__;
const RESIZABLE = window.__PICKER_RESIZABLE__ !== false;

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

// ─── RPC (live updates only) ──────────────────────────────────────────────────

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

// ─── DOM refs ────────────────────────────────────────────────────────────────

const search = document.getElementById("search") as HTMLInputElement;
const list   = document.getElementById("list")!;
const empty  = document.getElementById("empty")!;
const busy   = document.getElementById("busy")!;
const busyTitle = document.getElementById("busy-title")!;
const busyMeta = document.getElementById("busy-meta")!;
const footerRun = document.getElementById("footer-run") as HTMLButtonElement;
const footerClose = document.getElementById("footer-close") as HTMLButtonElement;
const resizeGrip = document.getElementById("resize-grip") as HTMLButtonElement;

let isExecuting = false;

// ─── Filtering ───────────────────────────────────────────────────────────────

function getFiltered(): PromptInfo[] {
  const q = search.value.toLowerCase().trim();
  if (!q) return allPrompts;
  return allPrompts.filter(
    (p) =>
      p.displayName.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q),
  );
}

// ─── Render ──────────────────────────────────────────────────────────────────

function render() {
  const filtered = getFiltered();
  list.innerHTML = "";
  empty.style.display = filtered.length ? "none" : "block";

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

    el.appendChild(nameEl);
    el.appendChild(catEl);

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

// ─── Actions (via fetch to local server) ─────────────────────────────────────

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

function initResizeGrip() {
  if (!PORT || !RESIZABLE) {
    resizeGrip.hidden = true;
    return;
  }

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  const onMove = (event: MouseEvent) => {
    if (!dragging) return;
    const width = Math.max(520, Math.round(startWidth + (event.clientX - startX)));
    const height = Math.max(360, Math.round(startHeight + (event.clientY - startY)));
    fetch(`http://localhost:${PORT}/window/resize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width, height }),
    }).catch(() => {});
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

// ─── Keyboard navigation ─────────────────────────────────────────────────────

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

// ─── Titlebar close ─────────────────────────────────────────────────────────

document.getElementById("titlebar-close")?.addEventListener("click", () => close());
footerClose.addEventListener("click", () => close());
footerRun.addEventListener("click", () => runSelected());

// ─── Init ────────────────────────────────────────────────────────────────────

render();
sendLog("info", "booted", { promptCount: allPrompts.length });
initResizeGrip();

// WebView2 may not have OS focus yet when the page loads — poll until it does.
function ensureFocus(retries = 30) {
  search.focus();
  if (document.activeElement !== search && retries > 0) {
    setTimeout(() => ensureFocus(retries - 1), 50);
  } else if (document.activeElement === search) {
    sendLog("debug", "focus_ready");
  }
}
ensureFocus();
