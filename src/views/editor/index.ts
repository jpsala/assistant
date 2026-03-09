/**
 * Prompt Editor — webview side
 *
 * Full CRUD for prompts: select, edit, save, delete.
 * Hotkey recorder supports single combos and two-step chords.
 * Communicates with Bun backend via HTTP fetch.
 */

declare global {
  interface Window {
    __EDITOR_PORT__?: number;
  }
}

type PromptData = {
  name: string;
  body: string;
  provider: string;
  model: string;
  hotkey: string;
  confirm: boolean;
  category: string;
};

type ModelInfo = { id: string; name: string };

// ─── State ──────────────────────────────────────────────────────────────────

const PORT = window.__EDITOR_PORT__;
let allPrompts: PromptData[] = [];
let filteredPrompts: PromptData[] = [];
let promptActiveIdx = -1;
let selectedName = "";

let allModels: ModelInfo[] = [];
let filteredModels: ModelInfo[] = [];
let modelActiveIdx = -1;
let defaultProvider = "openrouter";

// ─── DOM refs ───────────────────────────────────────────────────────────────

const filterInput = document.getElementById("prompt-filter") as HTMLInputElement;
const promptDropdown = document.getElementById("prompt-dropdown")!;
const nameInput = document.getElementById("prompt-name") as HTMLInputElement;
const providerInput = document.getElementById("prompt-provider") as HTMLSelectElement;
const modelInput = document.getElementById("prompt-model") as HTMLInputElement;
const modelDropdown = document.getElementById("model-dropdown")!;
const promptText = document.getElementById("prompt-text") as HTMLTextAreaElement;
const confirmInput = document.getElementById("prompt-confirm") as HTMLInputElement;
const btnDelete = document.getElementById("btn-delete") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function setStatus(text: string, kind: "idle" | "ok" | "error" = "idle") {
  statusEl.textContent = text;
  statusEl.setAttribute("data-kind", kind);
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── AHK ↔ Display conversion ──────────────────────────────────────────────

function ahkToDisplaySingle(ahk: string): string {
  if (!ahk) return "";
  let display = "";
  let rest = ahk;
  if (rest.includes("^")) { display += "Ctrl+"; rest = rest.replace("^", ""); }
  if (rest.includes("!")) { display += "Alt+"; rest = rest.replace("!", ""); }
  if (rest.includes("+")) { display += "Shift+"; rest = rest.replace("+", ""); }
  if (rest.includes("#")) { display += "Win+"; rest = rest.replace("#", ""); }
  if (rest.length === 1) rest = rest.toUpperCase();
  return display + rest;
}

function ahkToDisplay(ahk: string): string {
  if (!ahk) return "";
  if (ahk.includes(",")) {
    const parts = ahk.split(",");
    const prefix = ahkToDisplaySingle(parts[0] || "");
    const suffix = ahkToDisplaySingle(parts.slice(1).join(",") || "");
    return prefix && suffix ? `${prefix} \u2192 ${suffix}` : prefix || suffix;
  }
  return ahkToDisplaySingle(ahk);
}

function eventToAhk(e: KeyboardEvent, allowModifiers = true): string | null {
  if (!e || !e.key || e.key === "Unidentified") return null;
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  let ahk = "";
  if (allowModifiers) {
    if (e.ctrlKey) ahk += "^";
    if (e.altKey) ahk += "!";
    if (e.shiftKey) ahk += "+";
    if (e.metaKey) ahk += "#";
  } else if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) {
    return null;
  }
  const keyMap: Record<string, string> = {
    F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
    F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
    Escape: "Esc", Enter: "Enter", Tab: "Tab",
    Backspace: "Backspace", Delete: "Delete",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn",
    Insert: "Insert", " ": "Space",
  };
  const key = keyMap[e.key] || e.key.toLowerCase();
  if (!key || key === "undefined") return null;
  if (!allowModifiers && key.length > 1 && !keyMap[e.key]) return null;
  return ahk + key;
}

// ─── Hotkey recorder ────────────────────────────────────────────────────────

const hotkeyInput = document.getElementById("prompt-hotkey") as HTMLInputElement;
let recordingHotkey = false;
let waitingChordSecondKey = false;
let pendingPrimaryHotkey = "";

hotkeyInput.addEventListener("focus", () => {
  recordingHotkey = true;
  waitingChordSecondKey = false;
  pendingPrimaryHotkey = "";
  hotkeyInput.value = "Press combo (single) or prefix (chord)...";
});

hotkeyInput.addEventListener("blur", () => {
  if (recordingHotkey) {
    recordingHotkey = false;
    waitingChordSecondKey = false;
    pendingPrimaryHotkey = "";
    hotkeyInput.value = ahkToDisplay(hotkeyInput.dataset.ahkKey || "");
  }
});

hotkeyInput.addEventListener("keydown", (e) => {
  if (!recordingHotkey) return;
  e.preventDefault();
  e.stopPropagation();

  if (!waitingChordSecondKey) {
    const ahk = eventToAhk(e, true);
    if (!ahk) return;
    pendingPrimaryHotkey = ahk;
    hotkeyInput.dataset.ahkKey = ahk;
    waitingChordSecondKey = true;
    hotkeyInput.value = `${ahkToDisplay(ahk)} | press 2nd key for chord (Enter to keep single)`;
    return;
  }

  if (e.key === "Enter" || e.key === "Escape") {
    recordingHotkey = false;
    waitingChordSecondKey = false;
    pendingPrimaryHotkey = "";
    hotkeyInput.value = ahkToDisplay(hotkeyInput.dataset.ahkKey || "");
    hotkeyInput.blur();
    return;
  }

  const secondKey = eventToAhk(e, false);
  if (!secondKey) return;
  const chordAhk = `${pendingPrimaryHotkey},${secondKey}`;
  hotkeyInput.dataset.ahkKey = chordAhk;
  hotkeyInput.value = ahkToDisplay(chordAhk);
  recordingHotkey = false;
  waitingChordSecondKey = false;
  pendingPrimaryHotkey = "";
  hotkeyInput.blur();
});

document.getElementById("btn-clear-hotkey")!.addEventListener("click", () => {
  hotkeyInput.dataset.ahkKey = "";
  hotkeyInput.value = "";
  recordingHotkey = false;
  waitingChordSecondKey = false;
  pendingPrimaryHotkey = "";
});

// ─── Prompt picker (dropdown filter) ────────────────────────────────────────

function renderPromptDropdown() {
  promptDropdown.innerHTML = "";
  promptActiveIdx = -1;
  filteredPrompts.forEach((p) => {
    const div = document.createElement("div");
    div.className = "dropdown-item";
    const tags: string[] = [];
    if (p.provider && p.model) tags.push(`${p.provider} \u00b7 ${p.model}`);
    else if (p.provider) tags.push(p.provider);
    else if (p.model) tags.push(p.model);
    if (p.hotkey) tags.push(`HK: ${ahkToDisplay(p.hotkey)}`);
    if (p.confirm) tags.push("Confirm");
    div.innerHTML =
      `<span>${escHtml(p.name)}</span>` +
      (tags.length ? `<span class="tag">${escHtml(tags.join(" | "))}</span>` : "");
    div.addEventListener("mousedown", (e) => { e.preventDefault(); selectPrompt(p.name); });
    promptDropdown.appendChild(div);
  });
}

function showPromptDropdown() {
  if (filteredPrompts.length === 0) return;
  promptDropdown.classList.add("visible");
}

function hidePromptDropdown() {
  promptDropdown.classList.remove("visible");
  promptActiveIdx = -1;
}

function selectPrompt(name: string) {
  filterInput.value = "";
  hidePromptDropdown();
  const p = allPrompts.find((x) => x.name === name);
  if (!p) return;

  selectedName = name;
  nameInput.value = p.name;
  providerInput.value = p.provider || "";
  modelInput.value = p.model || "";
  hotkeyInput.dataset.ahkKey = p.hotkey || "";
  hotkeyInput.value = ahkToDisplay(p.hotkey || "");
  confirmInput.checked = p.confirm;
  promptText.value = p.body;
  btnDelete.disabled = false;
  promptText.readOnly = false;
  promptText.classList.remove("readonly");
  setStatus(`Editing: ${name}`);

  const effectiveProvider = providerInput.value || defaultProvider;
  loadModels(effectiveProvider);
}

function filterPromptList() {
  const typed = filterInput.value.toLowerCase();
  filteredPrompts = typed === ""
    ? [...allPrompts]
    : allPrompts.filter((p) => p.name.toLowerCase().includes(typed));
  renderPromptDropdown();
  showPromptDropdown();
}

filterInput.addEventListener("input", filterPromptList);
filterInput.addEventListener("focus", () => { filterPromptList(); showPromptDropdown(); });
filterInput.addEventListener("blur", () => setTimeout(hidePromptDropdown, 150));

filterInput.addEventListener("keydown", (e) => {
  if (!promptDropdown.classList.contains("visible")) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { showPromptDropdown(); e.preventDefault(); }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    promptActiveIdx = Math.min(promptActiveIdx + 1, filteredPrompts.length - 1);
    updateDropdownActive(promptDropdown, promptActiveIdx);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    promptActiveIdx = Math.max(promptActiveIdx - 1, 0);
    updateDropdownActive(promptDropdown, promptActiveIdx);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (promptActiveIdx >= 0 && filteredPrompts[promptActiveIdx])
      selectPrompt(filteredPrompts[promptActiveIdx].name);
  } else if (e.key === "Escape") {
    hidePromptDropdown();
    e.stopPropagation();
  }
});

// ─── Model picker ───────────────────────────────────────────────────────────

function renderModelDropdown() {
  modelDropdown.innerHTML = "";
  modelActiveIdx = -1;
  filteredModels.forEach((m) => {
    const div = document.createElement("div");
    div.className = "dropdown-item";
    div.innerHTML =
      `<span class="model-id">${escHtml(m.id)}</span>` +
      `<span class="model-name">${escHtml(m.name)}</span>`;
    div.addEventListener("mousedown", (e) => { e.preventDefault(); selectModel(m.id); });
    modelDropdown.appendChild(div);
  });
}

function showModelDropdown() {
  if (filteredModels.length === 0) return;
  modelDropdown.classList.add("visible");
}

function hideModelDropdown() {
  modelDropdown.classList.remove("visible");
  modelActiveIdx = -1;
}

function selectModel(id: string) {
  modelInput.value = id;
  hideModelDropdown();
}

function filterModelList() {
  const typed = modelInput.value.toLowerCase();
  filteredModels = typed === ""
    ? [...allModels]
    : allModels.filter((m) =>
        m.id.toLowerCase().includes(typed) || m.name.toLowerCase().includes(typed),
      );
  renderModelDropdown();
  showModelDropdown();
}

modelInput.addEventListener("input", filterModelList);
modelInput.addEventListener("focus", () => { filterModelList(); showModelDropdown(); });
modelInput.addEventListener("blur", () => setTimeout(hideModelDropdown, 150));

modelInput.addEventListener("keydown", (e) => {
  if (!modelDropdown.classList.contains("visible")) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { showModelDropdown(); e.preventDefault(); }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    modelActiveIdx = Math.min(modelActiveIdx + 1, filteredModels.length - 1);
    updateDropdownActive(modelDropdown, modelActiveIdx);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    modelActiveIdx = Math.max(modelActiveIdx - 1, 0);
    updateDropdownActive(modelDropdown, modelActiveIdx);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (modelActiveIdx >= 0 && filteredModels[modelActiveIdx])
      selectModel(filteredModels[modelActiveIdx].id);
  } else if (e.key === "Escape") {
    hideModelDropdown();
    e.stopPropagation();
  }
});

document.getElementById("btn-clear-model")!.addEventListener("click", () => {
  modelInput.value = "";
});

providerInput.addEventListener("change", () => {
  const effectiveProvider = providerInput.value || defaultProvider;
  loadModels(effectiveProvider);
});

// ─── Shared dropdown helper ─────────────────────────────────────────────────

function updateDropdownActive(container: HTMLElement, idx: number) {
  const items = container.querySelectorAll(".dropdown-item");
  items.forEach((item, i) => item.classList.toggle("active", i === idx));
  if (idx >= 0 && items[idx]) items[idx].scrollIntoView({ block: "nearest" });
}

// ─── API calls ──────────────────────────────────────────────────────────────

async function loadState() {
  if (!PORT) return;
  try {
    const res = await fetch(`http://localhost:${PORT}/state`);
    const data = (await res.json()) as {
      prompts: PromptData[];
      defaultProvider: string;
    };
    allPrompts = data.prompts;
    filteredPrompts = [...allPrompts];
    defaultProvider = data.defaultProvider || "openrouter";
    renderPromptDropdown();
    setStatus(`${allPrompts.length} prompts loaded`, "ok");
    sendLog("info", "state_loaded", { promptCount: allPrompts.length });
  } catch (error) {
    setStatus(`Error loading: ${error instanceof Error ? error.message : error}`, "error");
  }
}

async function loadModels(provider: string) {
  if (!PORT) return;
  try {
    const res = await fetch(`http://localhost:${PORT}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const data = (await res.json()) as { models: ModelInfo[] };
    allModels = data.models || [];
    filteredModels = [...allModels];
  } catch {
    allModels = [];
    filteredModels = [];
  }
}

async function savePrompt() {
  if (!PORT) return;
  const newName = nameInput.value.trim();
  if (!newName) {
    setStatus("Name cannot be empty", "error");
    return;
  }

  try {
    const res = await fetch(`http://localhost:${PORT}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oldName: selectedName || "",
        name: newName,
        body: promptText.value,
        provider: providerInput.value.trim(),
        model: modelInput.value.trim(),
        hotkey: hotkeyInput.dataset.ahkKey || "",
        confirm: confirmInput.checked,
      }),
    });
    const data = (await res.json()) as { prompts: PromptData[] };
    allPrompts = data.prompts;
    filteredPrompts = [...allPrompts];
    renderPromptDropdown();
    selectedName = newName;
    setStatus(`Saved: ${newName}`, "ok");
    sendLog("info", "save_succeeded", { name: newName });
  } catch (error) {
    setStatus(`Error saving: ${error instanceof Error ? error.message : error}`, "error");
  }
}

async function deletePrompt() {
  if (!PORT || !selectedName) return;
  if (!confirm(`Delete "${selectedName}"?`)) return;

  try {
    const res = await fetch(`http://localhost:${PORT}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: selectedName }),
    });
    const data = (await res.json()) as { prompts: PromptData[] };
    allPrompts = data.prompts;
    filteredPrompts = [...allPrompts];
    renderPromptDropdown();
    clearForm();
    setStatus(`Deleted: ${selectedName}`, "ok");
    sendLog("info", "delete_succeeded", { name: selectedName });
    selectedName = "";
  } catch (error) {
    setStatus(`Error deleting: ${error instanceof Error ? error.message : error}`, "error");
  }
}

function clearForm() {
  selectedName = "";
  nameInput.value = "";
  providerInput.value = "";
  modelInput.value = "";
  hotkeyInput.dataset.ahkKey = "";
  hotkeyInput.value = "";
  confirmInput.checked = false;
  promptText.value = "";
  promptText.readOnly = false;
  promptText.classList.remove("readonly");
  btnDelete.disabled = true;
}

function closeWindow() {
  if (!PORT) return;
  sendLog("info", "close_requested");
  fetch(`http://localhost:${PORT}/close`, { method: "POST" }).catch(() => {});
}

// ─── Buttons ────────────────────────────────────────────────────────────────

document.getElementById("btn-save")!.addEventListener("click", () => {
  savePrompt();
});

document.getElementById("btn-new")!.addEventListener("click", () => {
  clearForm();
  loadModels(defaultProvider);
  nameInput.focus();
  setStatus("New prompt — enter a name and text");
});

document.getElementById("btn-delete")!.addEventListener("click", () => {
  deletePrompt();
});

document.getElementById("btn-close")!.addEventListener("click", closeWindow);
document.getElementById("titlebar-close")!.addEventListener("click", closeWindow);

// ─── Keyboard shortcuts ─────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (recordingHotkey) return;
  if (e.ctrlKey && e.key === "s") {
    e.preventDefault();
    savePrompt();
  }
  const anyDropdownOpen =
    promptDropdown.classList.contains("visible") ||
    modelDropdown.classList.contains("visible");
  if (e.key === "Escape" && !anyDropdownOpen) {
    e.preventDefault();
    closeWindow();
  }
});

// ─── Init ───────────────────────────────────────────────────────────────────

loadState().then(() => loadModels(defaultProvider));
sendLog("info", "booted");
