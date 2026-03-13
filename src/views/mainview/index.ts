import { mountWindowShell } from "../framework/window-shell";
import { createButton, type ButtonVariant } from "../framework/components/button";
import { createButtonRow } from "../framework/components/button-row";
import { createSpinner } from "../framework/components/spinner";

type PromptInfo = {
  name: string;
  provider: string;
  model: string;
  body: string;
};

type ChatState = {
  originalText: string;
  hasSourceApp: boolean;
  provider: string;
  model: string;
  layout: {
    contextTextHeight: number;
    composerHeight: number;
  };
  prompts: PromptInfo[];
  selectedPromptName?: string;
};

declare global {
  interface Window {
    __MAINVIEW_PORT__?: number;
    __MAINVIEW_APPLY_STATE?: (state: Partial<ChatState>) => void;
    __MAINVIEW_APPLY_STATE_FROM_B64?: (payload: string) => void;
    __MAINVIEW_FOCUS_COMPOSER__?: () => void;
  }
}

const PORT = window.__MAINVIEW_PORT__;

const shell = mountWindowShell({
  title: "Prompt Chat",
  subtitle: "conversation",
  showIcon: true,
  showActionBar: true,
  showStatusBar: true,
  minWidth: 620,
  minHeight: 500,
});

const chatStyles = document.createElement("style");
chatStyles.textContent = `
  .chat-root {
    min-height: 0;
    height: 100%;
    display: grid;
    gap: 12px;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .chat-card {
    border: 1px solid var(--ws-border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--ws-bg-elevated) 74%, var(--ws-bg) 26%);
    overflow: hidden;
  }
  .chat-card-title {
    padding: 9px 12px 8px;
    border-bottom: 1px solid var(--ws-border);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ws-text-muted);
  }
  #original-text {
    width: 100%;
    min-height: 110px;
    max-height: 180px;
    padding: 12px;
    border: none;
    outline: none;
    resize: vertical;
    background: transparent;
    color: var(--ws-text);
    font: 13px/1.45 Consolas, "Fira Mono", monospace;
  }
  #original-text:focus,
  #composer-input:focus {
    box-shadow: inset 0 0 0 1px rgba(0, 122, 204, 0.5);
  }
  .chat-shell {
    min-height: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    border: 1px solid var(--ws-border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--ws-bg-elevated) 74%, var(--ws-bg) 26%);
    overflow: hidden;
  }
  .chat-header {
    padding: 10px 12px;
    border-bottom: 1px solid var(--ws-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: var(--ws-text-muted);
    font-size: 11px;
  }
  .chat-history {
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .message-row { display: flex; }
  .message-row.user { justify-content: flex-end; }
  .message-row.assistant { justify-content: flex-start; }
  .bubble {
    max-width: min(82%, 760px);
    border-radius: 12px;
    padding: 10px 12px;
    white-space: pre-wrap;
    line-height: 1.45;
    font-size: 13px;
  }
  .message-row.user .bubble {
    background: #12374f;
    color: #e8f6ff;
    border-bottom-right-radius: 4px;
  }
  .message-row.assistant .bubble {
    background: #24273b;
    color: var(--ws-text);
    border: 1px solid rgba(255,255,255,0.06);
    border-bottom-left-radius: 4px;
  }
  .message-meta {
    font-size: 11px;
    color: var(--ws-text-muted);
    margin-top: 6px;
  }
  .composer {
    border-top: 1px solid var(--ws-border);
    padding: 12px;
    display: grid;
    gap: 8px;
  }
  .composer-box { position: relative; }
  #composer-input {
    width: 100%;
    min-height: 92px;
    background: color-mix(in srgb, var(--ws-bg-muted) 72%, transparent 28%);
    color: var(--ws-text);
    border: 1px solid var(--ws-border-strong);
    border-radius: 12px;
    padding: 12px;
    font: inherit;
    line-height: 1.4;
    resize: vertical;
    outline: none;
  }
  .slash-dropdown {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 6px);
    background: var(--ws-bg-elevated);
    border: 1px solid var(--ws-border);
    border-radius: 10px;
    box-shadow: 0 10px 24px rgba(0,0,0,0.28);
    max-height: 220px;
    overflow-y: auto;
    display: none;
    z-index: 25;
  }
  .slash-dropdown.visible { display: block; }
  .slash-item {
    padding: 8px 10px;
    cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .slash-item:last-child { border-bottom: none; }
  .slash-item:hover, .slash-item.active { background: rgba(0, 122, 204, 0.16); }
  .slash-name { font-size: 13px; color: var(--ws-text); margin-bottom: 3px; }
  .slash-meta { font-size: 11px; color: var(--ws-text-muted); font-family: Consolas, monospace; }
  .composer-status {
    font-size: 11px;
    color: var(--ws-text-muted);
    min-height: 16px;
  }
`;
document.head.appendChild(chatStyles);

shell.content.innerHTML = `
  <div class="chat-root">
    <div class="chat-card">
      <div class="chat-card-title">Context Text</div>
      <textarea id="original-text" spellcheck="false" placeholder="Selected text appears here and can be edited before sending."></textarea>
    </div>
    <div class="chat-shell">
      <div class="chat-header">
        <div id="session-meta">Conversation</div>
        <div>\`/prompt\` · Enter send · Ctrl+Enter replace · Ctrl+Shift+Enter paste</div>
      </div>
      <div class="chat-history" id="chat-history"></div>
      <div class="composer">
        <div class="composer-box">
          <div class="slash-dropdown" id="slash-dropdown"></div>
          <textarea id="composer-input" spellcheck="false" placeholder="Write the next instruction..."></textarea>
        </div>
        <div class="composer-status" id="status">Ready</div>
      </div>
    </div>
  </div>
`;

shell.actionbarCopy.textContent = "Prompt chat uses the editable context above as conversation context.";
shell.statusLeft.textContent = "Prompt Chat";
shell.statusRight.textContent = "Enter send · Ctrl+Enter replace · Ctrl+Shift+Enter paste";

const actionButtons = [
  { id: "btn-send", label: "Send", shortcut: "Enter", variant: "primary" },
  { id: "btn-new-chat", label: "New Chat", shortcut: "Alt+N", variant: "secondary" },
  { id: "btn-copy", label: "Copy Latest", shortcut: "Alt+C", variant: "secondary" },
  { id: "btn-paste", label: "Paste in Source App", shortcut: "Ctrl+Shift+Enter", variant: "secondary" },
  { id: "btn-replace", label: "Replace Selected Text", shortcut: "Ctrl+Enter", variant: "secondary" },
  { id: "btn-close", label: "Close", shortcut: "Esc", variant: "ghost" },
];

const actionRow = createButtonRow("end");
shell.actionbarActions.appendChild(actionRow);

for (const item of actionButtons) {
  const button = createButton({
    id: item.id,
    label: item.label,
    shortcut: item.shortcut,
    variant: item.variant as ButtonVariant,
  });
  actionRow.appendChild(button);
}

const originalText = document.getElementById("original-text") as HTMLTextAreaElement;
const sessionMeta = document.getElementById("session-meta") as HTMLElement;
const chatHistory = document.getElementById("chat-history") as HTMLElement;
const composerInput = document.getElementById("composer-input") as HTMLTextAreaElement;
const statusEl = document.getElementById("status") as HTMLElement;
const slashDropdown = document.getElementById("slash-dropdown") as HTMLElement;
const sendButton = document.getElementById("btn-send") as HTMLButtonElement;
const newChatButton = document.getElementById("btn-new-chat") as HTMLButtonElement;
const copyButton = document.getElementById("btn-copy") as HTMLButtonElement;
const pasteButton = document.getElementById("btn-paste") as HTMLButtonElement;
const replaceButton = document.getElementById("btn-replace") as HTMLButtonElement;
const closeButton = document.getElementById("btn-close") as HTMLButtonElement;

let promptCatalog: PromptInfo[] = [];
let slashMatches: PromptInfo[] = [];
let slashActiveIndex = -1;
let provider = "";
let model = "";
let pendingPromptName = "";
let hasSourceApp = false;
let suppressLayoutPersist = false;
let layoutPersistTimer: ReturnType<typeof setTimeout> | null = null;
let busySpinner: HTMLSpanElement | null = null;
let isBusy = false;
const statusLabel = document.createElement("span");
statusLabel.textContent = "Prompt Chat";
shell.statusLeft.replaceChildren(statusLabel);

const messages: Array<{ role: "user" | "assistant"; content: string; label?: string }> = [];

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

function setStatus(text: string) {
  statusEl.textContent = text;
  statusLabel.textContent = text ? `Prompt Chat · ${text}` : "Prompt Chat";
}

function getLatestAssistantText(): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].content;
  }
  return "";
}

function updateActionButtons() {
  const hasComposerMessage = Boolean(composerInput.value.trim());
  const latestAssistantText = getLatestAssistantText().trim();
  const hasMessages = messages.length > 0;
  const hasDraft = Boolean(composerInput.value.trim() || pendingPromptName || originalText.value.trim());

  sendButton.disabled = isBusy || !hasComposerMessage;
  newChatButton.disabled = isBusy || (!hasMessages && !hasDraft);
  copyButton.disabled = isBusy || !latestAssistantText;
  pasteButton.disabled = isBusy || !latestAssistantText || !hasSourceApp;
  replaceButton.disabled = isBusy || !latestAssistantText || !hasSourceApp;
}

function setBusy(busy: boolean) {
  isBusy = busy;
  if (busy) {
    if (!busySpinner) {
      busySpinner = createSpinner("sm");
      shell.statusLeft.prepend(busySpinner);
    }
  } else {
    busySpinner?.remove();
    busySpinner = null;
  }
  updateActionButtons();
}

function focusComposer() {
  const applyFocus = () => {
    composerInput.focus();
    const len = composerInput.value.length;
    composerInput.setSelectionRange(len, len);
  };
  requestAnimationFrame(applyFocus);
  setTimeout(applyFocus, 0);
  setTimeout(applyFocus, 120);
}

function closeWindow() {
  if (!PORT) return Promise.resolve();
  return fetch(`http://localhost:${PORT}/close`, { method: "POST" }).catch(() => {});
}

function applyState(state: Partial<ChatState>) {
  if (typeof state.originalText === "string") originalText.value = state.originalText;
  if (typeof state.hasSourceApp === "boolean") hasSourceApp = state.hasSourceApp;
  if (state.layout) {
    suppressLayoutPersist = true;
    originalText.style.height = `${state.layout.contextTextHeight}px`;
    composerInput.style.height = `${state.layout.composerHeight}px`;
    setTimeout(() => { suppressLayoutPersist = false; }, 0);
  }
  if (Array.isArray(state.prompts)) {
    promptCatalog = state.prompts;
    updateSlashMatches();
  }
  if (typeof state.provider === "string") provider = state.provider;
  if (typeof state.model === "string") model = state.model;
  if (typeof state.selectedPromptName === "string") pendingPromptName = state.selectedPromptName;
  updateSessionMeta();
  updateActionButtons();
  focusComposer();
}

function updateSessionMeta() {
  const meta = [provider, model].filter(Boolean).join(" · ") || "Conversation";
  sessionMeta.textContent = meta;
  shell.setSubtitle([provider, model].filter(Boolean).join(" · ") || "conversation");
}

function renderMessages() {
  chatHistory.innerHTML = "";
  for (const message of messages) {
    const row = document.createElement("div");
    row.className = `message-row ${message.role}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.content;
    if (message.label || (message.role === "assistant" && (provider || model))) {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      meta.textContent = message.label || [provider, model].filter(Boolean).join(" · ");
      bubble.appendChild(meta);
    }
    row.appendChild(bubble);
    chatHistory.appendChild(row);
  }
  chatHistory.scrollTop = chatHistory.scrollHeight;
  updateActionButtons();
}

function resetConversation() {
  messages.length = 0;
  composerInput.value = "";
  pendingPromptName = "";
  slashMatches = [];
  renderSlashDropdown();
  renderMessages();
  setStatus("Ready");
  updateActionButtons();
  focusComposer();
}

function getSlashQuery(): string | null {
  const firstLine = (composerInput.value || "").split("\n")[0].trimStart();
  if (!firstLine.startsWith("/")) return null;
  return firstLine.slice(1);
}

function renderSlashDropdown() {
  slashDropdown.innerHTML = "";
  if (slashMatches.length === 0) {
    slashDropdown.classList.remove("visible");
    slashActiveIndex = -1;
    return;
  }
  slashMatches.forEach((prompt, index) => {
    const item = document.createElement("div");
    item.className = `slash-item${index === slashActiveIndex ? " active" : ""}`;
    item.innerHTML =
      `<div class="slash-name">/${prompt.name}</div>` +
      `<div class="slash-meta">${[prompt.provider, prompt.model].filter(Boolean).join(" · ") || "saved prompt"}</div>`;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applySlashSelection(index);
    });
    slashDropdown.appendChild(item);
  });
  slashDropdown.classList.add("visible");
}

function updateSlashMatches() {
  const query = getSlashQuery();
  if (query === null) {
    slashMatches = [];
    renderSlashDropdown();
    return;
  }
  const q = query.toLowerCase();
  slashMatches = q === ""
    ? promptCatalog.slice(0, 20)
    : promptCatalog.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 20);
  slashActiveIndex = slashMatches.length > 0 ? 0 : -1;
  renderSlashDropdown();
}

function applySlashSelection(index: number) {
  const selected = slashMatches[index];
  if (!selected) return;
  const lines = composerInput.value.split("\n");
  lines[0] = `/${selected.name}`;
  composerInput.value = lines.join("\n");
  slashMatches = [];
  renderSlashDropdown();
  composerInput.focus();
}

function parseSlashPrompt(rawMessage: string) {
  const lines = rawMessage.split("\n");
  const firstLine = (lines[0] || "").trim();
  if (!firstLine.startsWith("/")) return { displayMessage: rawMessage, promptName: "" };
  const name = firstLine.slice(1).trim();
  const prompt = promptCatalog.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!prompt) return { displayMessage: rawMessage, promptName: "" };
  const rest = lines.slice(1).join("\n").trim();
  return {
    displayMessage: rawMessage,
    promptName: prompt.name,
    effectiveMessage: rest || rawMessage,
  };
}

async function loadState() {
  if (!PORT) return;
  const response = await fetch(`http://localhost:${PORT}/state`);
  const state = await response.json() as ChatState;
  applyState(state);
  setStatus("Ready");
  updateActionButtons();
}

async function sendComposerMessage() {
  const rawMessage = composerInput.value.trim();
  if (!rawMessage) {
    setBusy(false);
    setStatus("Write a message first");
    return;
  }

  const parsed = parseSlashPrompt(rawMessage) as {
    displayMessage: string;
    promptName?: string;
    effectiveMessage?: string;
  };
  const effectivePromptName = parsed.promptName || pendingPromptName;

  messages.push({
    role: "user",
    content: parsed.displayMessage,
    label: effectivePromptName ? `/${effectivePromptName}` : "",
  });
  renderMessages();
  composerInput.value = "";
  pendingPromptName = "";
  slashMatches = [];
  renderSlashDropdown();
  setBusy(true);
  setStatus("Sending...");

  const requestMessages = messages
    .filter((message) => message.role === "assistant" || message.role === "user")
    .map((message, index) => index === messages.length - 1
      ? { role: "user" as const, content: parsed.effectiveMessage || parsed.displayMessage }
      : { role: message.role, content: message.content });

  const response = await fetch(`http://localhost:${PORT}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: requestMessages,
      promptName: effectivePromptName || "",
      selectedText: originalText.value,
    }),
  });

  if (!response.ok || !response.body) {
    setBusy(false);
    setStatus("Chat failed");
    return;
  }

  const assistant = { role: "assistant" as const, content: "" };
  messages.push(assistant);
  renderMessages();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const eventMatch = block.match(/event:\s*([^\n\r]+)/);
      const dataLine = block.split(/\r?\n/).find((line) => line.startsWith("data:"));
      if (!dataLine) continue;

      const payload = JSON.parse(dataLine.slice(5).trim()) as Record<string, string>;
      const event = eventMatch?.[1]?.trim() ?? "message";

      if (event === "start") {
        provider = payload.provider ?? provider;
        model = payload.model ?? model;
        updateSessionMeta();
        setStatus(`Streaming with ${provider} · ${model}...`);
      } else if (event === "delta") {
        assistant.content += payload.delta ?? "";
        renderMessages();
      } else if (event === "done") {
        assistant.content = payload.content ?? assistant.content;
        provider = payload.provider ?? provider;
        model = payload.model ?? model;
        updateSessionMeta();
        renderMessages();
        setBusy(false);
        setStatus("Done");
      } else if (event === "error") {
        assistant.content = payload.error ?? "Unknown error";
        renderMessages();
        setBusy(false);
        setStatus("Chat failed");
      }
    }
  }

  setBusy(false);
}

function copyLatestResponse() {
  const text = getLatestAssistantText();
  if (!text || !PORT) {
    setStatus("No assistant response to copy");
    return;
  }
  fetch(`http://localhost:${PORT}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).then(() => setStatus("Copied latest response"))
    .catch(() => setStatus("Copy failed"));
}

function pasteLatestResponse() {
  const text = getLatestAssistantText();
  if (!text || !PORT) {
    setStatus("No assistant response to paste");
    return;
  }
  fetch(`http://localhost:${PORT}/paste`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).then(() => closeWindow())
    .catch(() => setStatus("Paste failed"));
}

function replaceWithLatestResponse() {
  const text = getLatestAssistantText();
  if (!text || !PORT) {
    setStatus("No assistant response to apply");
    return;
  }
  fetch(`http://localhost:${PORT}/replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).then(() => closeWindow())
    .catch(() => setStatus("Replace failed"));
}

function persistLayout() {
  if (!PORT || suppressLayoutPersist) return;
  if (layoutPersistTimer) clearTimeout(layoutPersistTimer);
  layoutPersistTimer = setTimeout(() => {
    layoutPersistTimer = null;
    fetch(`http://localhost:${PORT}/layout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contextTextHeight: Math.round(originalText.getBoundingClientRect().height),
        composerHeight: Math.round(composerInput.getBoundingClientRect().height),
      }),
    }).catch(() => {});
  }, 120);
}

function initTextareaLayoutPersistence() {
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => persistLayout());
  observer.observe(originalText);
  observer.observe(composerInput);
  originalText.addEventListener("mouseup", persistLayout);
  composerInput.addEventListener("mouseup", persistLayout);
}

composerInput.addEventListener("input", () => updateSlashMatches());
composerInput.addEventListener("input", () => updateActionButtons());
originalText.addEventListener("input", () => updateActionButtons());
composerInput.addEventListener("keydown", (event) => {
  const slashVisible = slashDropdown.classList.contains("visible");
  if (slashVisible) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      slashActiveIndex = Math.min(slashActiveIndex + 1, slashMatches.length - 1);
      renderSlashDropdown();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      slashActiveIndex = Math.max(slashActiveIndex - 1, 0);
      renderSlashDropdown();
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && slashActiveIndex >= 0) {
      event.preventDefault();
      applySlashSelection(slashActiveIndex);
      return;
    }
    if (event.key === "Escape") {
      slashMatches = [];
      renderSlashDropdown();
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendComposerMessage();
  }
});

sendButton.addEventListener("click", () => void sendComposerMessage());
newChatButton.addEventListener("click", () => resetConversation());
copyButton.addEventListener("click", () => copyLatestResponse());
pasteButton.addEventListener("click", () => pasteLatestResponse());
replaceButton.addEventListener("click", () => replaceWithLatestResponse());
closeButton.addEventListener("click", () => { void closeWindow(); });

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.ctrlKey && event.shiftKey) {
    event.preventDefault();
    pasteLatestResponse();
    return;
  }
  if (event.key === "Enter" && event.ctrlKey) {
    event.preventDefault();
    replaceWithLatestResponse();
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    copyLatestResponse();
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    resetConversation();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    void closeWindow();
  }
});

window.__MAINVIEW_APPLY_STATE = (state) => {
  applyState(state);
  setStatus("Ready");
};

window.__MAINVIEW_FOCUS_COMPOSER__ = () => {
  focusComposer();
};

window.__MAINVIEW_APPLY_STATE_FROM_B64 = (payload) => {
  const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  window.__MAINVIEW_APPLY_STATE?.(JSON.parse(json) as Partial<ChatState>);
};

void loadState();
initTextareaLayoutPersistence();
focusComposer();
updateActionButtons();
sendLog("info", "booted");
