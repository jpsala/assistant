import { mountWindowShell, postWindowMessage, sendWindowLog } from "../framework/window-shell";

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
  selectAllIfEmpty: boolean | null;
  category: string;
};

type ModelInfo = { id: string; name: string };

const PORT = window.__EDITOR_PORT__;

const shell = mountWindowShell({
  title: "Prompt Editor",
  subtitle: "prompt library",
  showIcon: true,
  showActionBar: true,
  showStatusBar: true,
  minWidth: 680,
  minHeight: 560,
});

const style = document.createElement("style");
style.textContent = `
  .editor-root {
    min-height: 0;
    height: 100%;
    display: grid;
    gap: 14px;
    grid-template-rows: auto 1fr;
  }
  .editor-banner {
    display: grid;
    gap: 4px;
  }
  .editor-kicker {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--ws-accent);
    font-weight: 700;
  }
  .editor-sub {
    color: var(--ws-text-muted);
    font-size: 13px;
  }
  .editor-panel {
    min-height: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 12px;
  }
  .editor-grid {
    display: grid;
    gap: 10px;
  }
  .editor-section {
    padding: 14px;
    border: 1px solid var(--ws-border);
    border-radius: 14px;
    background: color-mix(in srgb, var(--ws-bg-elevated) 84%, var(--ws-bg) 16%);
  }
  .editor-main {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    gap: 12px;
  }
  .editor-form {
    min-height: 0;
    display: grid;
    gap: 10px;
  }
  .editor-field {
    display: grid;
    gap: 6px;
  }
  .editor-field label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ws-text-muted);
  }
  .editor-field label .hint {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
  .editor-input,
  .editor-select,
  .editor-textarea,
  .editor-button {
    font: inherit;
  }
  .editor-input,
  .editor-select,
  .editor-textarea {
    width: 100%;
    background: color-mix(in srgb, var(--ws-bg-muted) 84%, transparent 16%);
    color: var(--ws-text);
    border: 1px solid color-mix(in srgb, var(--ws-border) 74%, transparent 26%);
    border-radius: 10px;
    padding: 9px 10px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .editor-input:focus,
  .editor-select:focus,
  .editor-textarea:focus {
    border-color: color-mix(in srgb, var(--ws-accent) 70%, white 30%);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ws-accent) 18%, transparent 82%);
  }
  .editor-select option {
    background: #1e2038;
    color: var(--ws-text);
  }
  .editor-textarea {
    min-height: 0;
    height: 100%;
    resize: vertical;
    font-family: Consolas, "Fira Mono", monospace;
    line-height: 1.5;
  }
  .editor-textarea.readonly {
    color: #666;
    background: rgba(255, 255, 255, 0.02);
  }
  .editor-picker {
    position: relative;
  }
  .editor-dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    background: #1e2038;
    border: 1px solid color-mix(in srgb, var(--ws-border) 80%, transparent 20%);
    border-radius: 0 0 10px 10px;
    max-height: 200px;
    overflow-y: auto;
    z-index: 40;
    display: none;
  }
  .editor-dropdown.visible { display: block; }
  .dropdown-item {
    padding: 7px 10px;
    cursor: pointer;
    font-size: 13px;
    color: var(--ws-text);
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .dropdown-item:hover, .dropdown-item.active {
    background: rgba(0, 122, 204, 0.18);
    color: white;
  }
  .dropdown-item .tag,
  .dropdown-item .model-name,
  .dropdown-item .model-id {
    font-family: Consolas, "Fira Mono", monospace;
    font-size: 11px;
    color: var(--ws-text-muted);
  }
  .editor-inline {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .editor-inline .editor-picker {
    flex: 1;
  }
  .editor-icon-btn {
    border: 1px solid color-mix(in srgb, var(--ws-border) 74%, transparent 26%);
    border-radius: 10px;
    background: color-mix(in srgb, var(--ws-bg-muted) 84%, transparent 16%);
    color: var(--ws-text-muted);
    padding: 8px 10px;
    cursor: pointer;
  }
  .editor-icon-btn:hover {
    background: color-mix(in srgb, var(--ws-bg-muted) 94%, transparent 6%);
    color: var(--ws-text);
  }
  .editor-hotkey-row .editor-input {
    font-family: Consolas, "Fira Mono", monospace;
    font-size: 12px;
    cursor: pointer;
  }
  .editor-confirm {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    font-size: 12px;
    color: var(--ws-text-muted);
  }
  .editor-confirm input[type="checkbox"] {
    width: 14px;
    height: 14px;
    accent-color: var(--ws-accent);
  }
  .editor-body {
    min-height: 0;
  }
  .editor-status {
    font-size: 12px;
    color: var(--ws-text-muted);
  }
  .editor-status[data-kind="ok"] { color: #3ddc97; }
  .editor-status[data-kind="error"] { color: #ef4444; }
  .editor-actionbar {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .editor-button {
    padding: 8px 14px;
    border: 1px solid color-mix(in srgb, var(--ws-border) 74%, transparent 26%);
    border-radius: 10px;
    background: color-mix(in srgb, var(--ws-bg-muted) 84%, transparent 16%);
    color: var(--ws-text);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .editor-button:hover { background: color-mix(in srgb, var(--ws-bg-muted) 94%, transparent 6%); }
  .editor-button.primary {
    background: var(--ws-accent);
    border-color: var(--ws-accent);
    color: white;
  }
  .editor-button.danger {
    background: #ef4444;
    border-color: #ef4444;
    color: white;
  }
  .editor-button:disabled {
    opacity: 0.35;
    cursor: default;
    pointer-events: none;
  }
  @media (max-width: 940px) {
    .editor-main {
      grid-template-columns: 1fr;
    }
  }
`;
document.head.appendChild(style);

shell.content.innerHTML = `
  <div class="editor-root">
    <div class="editor-banner">
      <div class="editor-kicker">Prompt Library</div>
      <div class="editor-sub">Edit reusable prompts, provider overrides, and optional hotkeys.</div>
    </div>
    <div class="editor-panel">
      <section class="editor-section editor-grid">
        <div class="editor-field">
          <label>Prompt <span class="hint">type to filter</span></label>
          <div class="editor-picker">
            <input class="editor-input" type="text" id="prompt-filter" autocomplete="off" placeholder="Search prompts..." />
            <div id="prompt-dropdown" class="editor-dropdown"></div>
          </div>
        </div>
      </section>

      <div class="editor-main">
        <section class="editor-section editor-form">
          <div class="editor-field">
            <label>Name</label>
            <input class="editor-input" type="text" id="prompt-name" placeholder="Prompt name..." />
          </div>

          <div class="editor-field">
            <label>Category <span class="hint">(optional)</span></label>
            <input class="editor-input" type="text" id="prompt-category" placeholder="writing, coding, summarize..." />
          </div>

          <div class="editor-field">
            <label>Provider <span class="hint">(blank = app default)</span></label>
            <select class="editor-select" id="prompt-provider">
              <option value="">(Use app default)</option>
              <option value="openrouter">OpenRouter</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="xai">xAI</option>
            </select>
          </div>

          <div class="editor-field">
            <label>Model <span class="hint">(blank = provider default)</span></label>
            <div class="editor-inline">
              <div class="editor-picker">
                <input class="editor-input" type="text" id="prompt-model" autocomplete="off" placeholder="Search models..." />
                <div id="model-dropdown" class="editor-dropdown"></div>
              </div>
              <button class="editor-icon-btn" id="btn-clear-model" title="Clear model" type="button">&#x2715;</button>
            </div>
          </div>

          <div class="editor-field">
            <label>Hotkey <span class="hint">(single or chord)</span></label>
            <div class="editor-inline editor-hotkey-row">
              <input class="editor-input" type="text" id="prompt-hotkey" readonly placeholder="Click to set hotkey..." data-ahk-key="" />
              <button class="editor-icon-btn" id="btn-clear-hotkey" title="Clear hotkey" type="button">&#x2715;</button>
            </div>
            <div class="editor-confirm">
              <input type="checkbox" id="prompt-confirm" />
              <label for="prompt-confirm">Confirm prompt before running</label>
            </div>
            <div class="editor-confirm">
              <label for="prompt-select-all">Select all if empty:</label>
              <select class="editor-select" id="prompt-select-all" style="width:auto;padding:3px 8px;font-size:12px;border-radius:6px;">
                <option value="default">Default (use global setting)</option>
                <option value="true">Always</option>
                <option value="false">Never</option>
              </select>
            </div>
          </div>
        </section>

        <section class="editor-section editor-body">
          <div class="editor-field" style="height:100%;">
            <label>Prompt text</label>
            <textarea class="editor-textarea" id="prompt-text" placeholder="Enter prompt instructions..."></textarea>
          </div>
        </section>
      </div>
    </div>
  </div>
`;

const filterInput = document.getElementById("prompt-filter") as HTMLInputElement;
const promptDropdown = document.getElementById("prompt-dropdown") as HTMLElement;
const nameInput = document.getElementById("prompt-name") as HTMLInputElement;
const categoryInput = document.getElementById("prompt-category") as HTMLInputElement;
const providerInput = document.getElementById("prompt-provider") as HTMLSelectElement;
const modelInput = document.getElementById("prompt-model") as HTMLInputElement;
const modelDropdown = document.getElementById("model-dropdown") as HTMLElement;
const promptText = document.getElementById("prompt-text") as HTMLTextAreaElement;
const confirmInput = document.getElementById("prompt-confirm") as HTMLInputElement;
const selectAllInput = document.getElementById("prompt-select-all") as HTMLSelectElement;

const statusEl = document.createElement("span");
statusEl.className = "editor-status";
statusEl.dataset.kind = "idle";
shell.statusLeft.replaceChildren(statusEl);
shell.statusRight.textContent = "Ctrl+S save";
shell.actionbarCopy.textContent = "Prompts are stored locally and reloaded by the watcher.";

const btnSave = document.createElement("button");
btnSave.className = "editor-button primary";
btnSave.id = "btn-save";
btnSave.type = "button";
btnSave.textContent = "Save";

const btnNew = document.createElement("button");
btnNew.className = "editor-button";
btnNew.id = "btn-new";
btnNew.type = "button";
btnNew.textContent = "New";

const btnDelete = document.createElement("button");
btnDelete.className = "editor-button danger";
btnDelete.id = "btn-delete";
btnDelete.type = "button";
btnDelete.disabled = true;
btnDelete.textContent = "Delete";

const btnClose = document.createElement("button");
btnClose.className = "editor-button";
btnClose.id = "btn-close";
btnClose.type = "button";
btnClose.textContent = "Close";

shell.actionbarActions.classList.add("editor-actionbar");
shell.actionbarActions.append(btnSave, btnNew, btnDelete, btnClose);

let allPrompts: PromptData[] = [];
let filteredPrompts: PromptData[] = [];
let promptActiveIdx = -1;
let selectedName = "";

let allModels: ModelInfo[] = [];
let filteredModels: ModelInfo[] = [];
let modelActiveIdx = -1;
let defaultProvider = "openrouter";

function sendLog(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  meta: Record<string, unknown> = {},
) {
  sendWindowLog(PORT, level, event, meta);
}

function setStatus(text: string, kind: "idle" | "ok" | "error" = "idle") {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

function renderPromptDropdown() {
  promptDropdown.innerHTML = "";
  promptActiveIdx = -1;
  filteredPrompts.forEach((p) => {
    const div = document.createElement("div");
    div.className = "dropdown-item";
    const tags: string[] = [];
    if (p.category) tags.push(`#${p.category}`);
    if (p.provider && p.model) tags.push(`${p.provider} · ${p.model}`);
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
  categoryInput.value = p.category || "";
  providerInput.value = p.provider || "";
  modelInput.value = p.model || "";
  hotkeyInput.dataset.ahkKey = p.hotkey || "";
  hotkeyInput.value = ahkToDisplay(p.hotkey || "");
  confirmInput.checked = p.confirm;
  selectAllInput.value = p.selectAllIfEmpty === true ? "true" : p.selectAllIfEmpty === false ? "false" : "default";
  promptText.value = p.body;
  btnDelete.disabled = false;
  promptText.readOnly = false;
  promptText.classList.remove("readonly");
  setStatus(`Editing: ${name}`);

  const effectiveProvider = providerInput.value || defaultProvider;
  void loadModels(effectiveProvider);
}

function filterPromptList() {
  const typed = filterInput.value.toLowerCase();
  filteredPrompts = typed === ""
    ? [...allPrompts]
    : allPrompts.filter((p) =>
      p.name.toLowerCase().includes(typed) ||
      p.category.toLowerCase().includes(typed),
    );
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
    if (promptActiveIdx >= 0 && filteredPrompts[promptActiveIdx]) selectPrompt(filteredPrompts[promptActiveIdx].name);
  } else if (e.key === "Escape") {
    hidePromptDropdown();
    e.stopPropagation();
  }
});

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
    if (modelActiveIdx >= 0 && filteredModels[modelActiveIdx]) selectModel(filteredModels[modelActiveIdx].id);
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
  void loadModels(effectiveProvider);
});

function updateDropdownActive(container: HTMLElement, idx: number) {
  const items = container.querySelectorAll(".dropdown-item");
  items.forEach((item, i) => item.classList.toggle("active", i === idx));
  if (idx >= 0 && items[idx]) items[idx].scrollIntoView({ block: "nearest" });
}

async function loadState() {
  if (!PORT) return;
  try {
    const res = await fetch(`http://localhost:${PORT}/state`);
    const data = await res.json() as {
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
    const data = await res.json() as { models: ModelInfo[] };
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
        category: categoryInput.value.trim(),
        confirm: confirmInput.checked,
        selectAllIfEmpty: selectAllInput.value as "true" | "false" | "default",
      }),
    });
    const data = await res.json() as { prompts?: PromptData[]; error?: string };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    allPrompts = data.prompts || [];
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
    const data = await res.json() as { prompts: PromptData[] };
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
  categoryInput.value = "";
  providerInput.value = "";
  modelInput.value = "";
  hotkeyInput.dataset.ahkKey = "";
  hotkeyInput.value = "";
  confirmInput.checked = false;
  selectAllInput.value = "default";
  promptText.value = "";
  promptText.readOnly = false;
  promptText.classList.remove("readonly");
  btnDelete.disabled = true;
}

function closeWindow() {
  sendLog("info", "close_requested");
  void postWindowMessage(PORT, "/close");
}

btnSave.addEventListener("click", () => { void savePrompt(); });
btnNew.addEventListener("click", () => {
  clearForm();
  void loadModels(defaultProvider);
  nameInput.focus();
  setStatus("New prompt — enter a name and text");
});
btnDelete.addEventListener("click", () => { void deletePrompt(); });
btnClose.addEventListener("click", closeWindow);

document.addEventListener("keydown", (e) => {
  if (recordingHotkey) return;
  if (e.ctrlKey && e.key === "s") {
    e.preventDefault();
    void savePrompt();
  }
  const anyDropdownOpen =
    promptDropdown.classList.contains("visible") ||
    modelDropdown.classList.contains("visible");
  if (e.key === "Escape" && !anyDropdownOpen) {
    e.preventDefault();
    closeWindow();
  }
});

void loadState().then(() => loadModels(defaultProvider));
sendLog("info", "booted");
