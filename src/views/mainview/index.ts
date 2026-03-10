type PromptInfo = {
  name: string;
  provider: string;
  model: string;
  body: string;
};

type ChatState = {
  originalText: string;
  provider: string;
  model: string;
  prompts: PromptInfo[];
};

declare global {
  interface Window {
    __MAINVIEW_PORT__?: number;
    __MAINVIEW_RESIZABLE__?: boolean;
    __MAINVIEW_APPLY_STATE?: (state: Partial<ChatState>) => void;
    __MAINVIEW_APPLY_STATE_FROM_B64?: (payload: string) => void;
  }
}

const PORT = window.__MAINVIEW_PORT__;
const RESIZABLE = window.__MAINVIEW_RESIZABLE__ !== false;

const originalText = document.getElementById("original-text") as HTMLTextAreaElement;
const sessionMeta = document.getElementById("session-meta")!;
const chatHistory = document.getElementById("chat-history")!;
const composerInput = document.getElementById("composer-input") as HTMLTextAreaElement;
const statusEl = document.getElementById("status")!;
const slashDropdown = document.getElementById("slash-dropdown")!;
const resizeGrip = document.getElementById("resize-grip") as HTMLButtonElement;

let promptCatalog: PromptInfo[] = [];
let slashMatches: PromptInfo[] = [];
let slashActiveIndex = -1;
let provider = "";
let model = "";

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
}

function closeWindow() {
  if (!PORT) return Promise.resolve();
  return fetch(`http://localhost:${PORT}/close`, { method: "POST" }).catch(() => {});
}

function applyState(state: Partial<ChatState>) {
  if (typeof state.originalText === "string") {
    originalText.value = state.originalText;
  }
  if (Array.isArray(state.prompts)) {
    promptCatalog = state.prompts;
    updateSlashMatches();
  }
  if (typeof state.provider === "string") {
    provider = state.provider;
  }
  if (typeof state.model === "string") {
    model = state.model;
  }
  updateSessionMeta();
}

function updateSessionMeta() {
  sessionMeta.textContent = [provider, model].filter(Boolean).join(" · ") || "Conversation";
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
      meta.textContent =
        message.label ||
        [provider, model].filter(Boolean).join(" · ");
      bubble.appendChild(meta);
    }

    row.appendChild(bubble);
    chatHistory.appendChild(row);
  }
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function resetConversation() {
  messages.length = 0;
  composerInput.value = "";
  slashMatches = [];
  renderSlashDropdown();
  renderMessages();
  setStatus("Ready");
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
    item.className = "slash-item" + (index === slashActiveIndex ? " active" : "");
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
  if (!firstLine.startsWith("/")) {
    return { displayMessage: rawMessage, promptName: "" };
  }

  const name = firstLine.slice(1).trim();
  const prompt = promptCatalog.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!prompt) {
    return { displayMessage: rawMessage, promptName: "" };
  }

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
}

async function sendComposerMessage() {
  const rawMessage = composerInput.value.trim();
  if (!rawMessage) {
    setStatus("Write a message first");
    return;
  }

  const parsed = parseSlashPrompt(rawMessage) as {
    displayMessage: string;
    promptName?: string;
    effectiveMessage?: string;
  };

  messages.push({
    role: "user",
    content: parsed.displayMessage,
    label: parsed.promptName ? `/${parsed.promptName}` : "",
  });
  renderMessages();
  composerInput.value = "";
  slashMatches = [];
  renderSlashDropdown();
  setStatus("Sending...");

  const requestMessages = [
    ...messages
      .filter((message) => message.role === "assistant" || message.role === "user")
      .map((message, index) => {
        if (index === messages.length - 1) {
          return {
            role: "user" as const,
            content: parsed.effectiveMessage || parsed.displayMessage,
          };
        }
        return { role: message.role, content: message.content };
      }),
  ];

  const response = await fetch(`http://localhost:${PORT}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: requestMessages,
      promptName: parsed.promptName || "",
    }),
  });

  if (!response.ok || !response.body) {
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
        setStatus("Done");
      } else if (event === "error") {
        assistant.content = payload.error ?? "Unknown error";
        renderMessages();
        setStatus("Chat failed");
      }
    }
  }
}

function getLatestAssistantText(): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].content;
  }
  return "";
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
    const width = Math.max(620, Math.round(startWidth + (event.clientX - startX)));
    const height = Math.max(500, Math.round(startHeight + (event.clientY - startY)));
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

composerInput.addEventListener("input", () => updateSlashMatches());
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

document.getElementById("btn-send")?.addEventListener("click", () => void sendComposerMessage());
document.getElementById("btn-new-chat")?.addEventListener("click", () => resetConversation());
document.getElementById("btn-copy")?.addEventListener("click", () => {
  const text = getLatestAssistantText();
  if (!text || !PORT) return;
  fetch(`http://localhost:${PORT}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
    .then(() => setStatus("Copied latest response"))
    .catch(() => setStatus("Copy failed"));
});
document.getElementById("btn-paste")?.addEventListener("click", () => {
  const text = getLatestAssistantText();
  if (!text || !PORT) {
    setStatus("No assistant response to paste");
    return;
  }
  fetch(`http://localhost:${PORT}/paste`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
    .then(() => closeWindow())
    .catch(() => setStatus("Paste failed"));
});
document.getElementById("btn-replace")?.addEventListener("click", () => {
  const text = getLatestAssistantText();
  if (!text || !PORT) {
    setStatus("No assistant response to apply");
    return;
  }
  fetch(`http://localhost:${PORT}/replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
    .then(() => closeWindow())
    .catch(() => setStatus("Replace failed"));
});
document.getElementById("btn-close")?.addEventListener("click", () => {
  void closeWindow();
});
document.getElementById("titlebar-close")?.addEventListener("click", () => {
  void closeWindow();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    void closeWindow();
  }
});

window.__MAINVIEW_APPLY_STATE = (state) => {
  applyState(state);
  setStatus("Ready");
};

window.__MAINVIEW_APPLY_STATE_FROM_B64 = (payload) => {
  const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  window.__MAINVIEW_APPLY_STATE?.(JSON.parse(json) as Partial<ChatState>);
};

void loadState();
initResizeGrip();
sendLog("info", "booted");
