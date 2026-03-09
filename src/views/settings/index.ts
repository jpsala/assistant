type Provider = "openrouter" | "openai" | "anthropic" | "xai";

type Settings = {
  provider: Provider;
  model: string;
  apiKeys: Record<Provider, string>;
  maxTokens: number;
  feedbackStyle: "custom";
  hotkeys: {
    promptChat: string;
    promptPicker: string;
    reload: string;
  };
  windows: {
    chat: { x: number; y: number; w: number; h: number };
    picker: { x: number; y: number; w: number; h: number };
    settings: { x: number; y: number; w: number; h: number };
    editor: { x: number; y: number; w: number; h: number };
  };
  onboarded: boolean;
};

declare global {
  interface Window {
    __SETTINGS_PORT__?: number;
    __SETTINGS_RESIZABLE__?: boolean;
  }
}

const PORT = window.__SETTINGS_PORT__;
const RESIZABLE = window.__SETTINGS_RESIZABLE__ !== false;

const providerSelect = document.getElementById("provider") as HTMLSelectElement;
const modelSelect = document.getElementById("model") as HTMLSelectElement;
const modelRefresh = document.getElementById("model-refresh") as HTMLButtonElement;
const modelRefreshFooter = document.getElementById("model-refresh-footer") as HTMLButtonElement;
const modelHint = document.getElementById("model-hint")!;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const maxTokens = document.getElementById("maxTokens") as HTMLInputElement;
const promptChat = document.getElementById("promptChat") as HTMLInputElement;
const promptPicker = document.getElementById("promptPicker") as HTMLInputElement;
const reloadHotkey = document.getElementById("reloadHotkey") as HTMLInputElement;
const resizeGrip = document.getElementById("resize-grip") as HTMLButtonElement;

const apiKeyInputs: Record<Provider, HTMLInputElement> = {
  openrouter: document.getElementById("key-openrouter") as HTMLInputElement,
  openai: document.getElementById("key-openai") as HTMLInputElement,
  anthropic: document.getElementById("key-anthropic") as HTMLInputElement,
  xai: document.getElementById("key-xai") as HTMLInputElement,
};

let currentSettings: Settings | null = null;
let currentModels: string[] = [];

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

function setStatus(message: string, kind: "idle" | "ok" | "error" | "loading" = "idle") {
  statusEl.textContent = message;
  statusEl.setAttribute("data-kind", kind);
}

function getDraftSettings(): Settings {
  if (!currentSettings) {
    throw new Error("settings not loaded");
  }

  return {
    ...currentSettings,
    provider: providerSelect.value as Provider,
    model: modelSelect.value || currentSettings.model,
    apiKeys: {
      openrouter: apiKeyInputs.openrouter.value,
      openai: apiKeyInputs.openai.value,
      anthropic: apiKeyInputs.anthropic.value,
      xai: apiKeyInputs.xai.value,
    },
    maxTokens: Number(maxTokens.value),
    feedbackStyle: "custom",
    hotkeys: {
      promptChat: promptChat.value,
      promptPicker: promptPicker.value,
      reload: reloadHotkey.value,
    },
  };
}

function renderModelOptions(models: string[], preferred?: string) {
  currentModels = models;
  modelSelect.innerHTML = "";

  const chosen = preferred && models.includes(preferred)
    ? preferred
    : preferred || models[0] || "";

  if (!models.length) {
    const option = document.createElement("option");
    option.value = preferred ?? "";
    option.textContent = preferred ? preferred : "No models loaded";
    modelSelect.appendChild(option);
    modelSelect.value = option.value;
    return;
  }

  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  });
  modelSelect.value = chosen;
}

async function loadModels(preferred?: string) {
  const provider = providerSelect.value as Provider;
  const apiKey = apiKeyInputs[provider].value.trim();
  setStatus("Loading models...", "loading");
  modelHint.textContent = apiKey ? "Refreshing model list for selected provider." : "Add an API key to fetch provider models.";
  modelRefresh.disabled = true;
  modelRefreshFooter.disabled = true;

  try {
    if (!PORT) throw new Error("missing settings port");
    const res = await fetch(`http://localhost:${PORT}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey }),
    });
    const json = await res.json() as { models: string[]; error?: string };
    if (!res.ok) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    renderModelOptions(json.models, preferred);
    modelHint.textContent = `${json.models.length} models available for ${provider}.`;
    setStatus("Models updated.", "ok");
    sendLog("info", "models_loaded", { provider, count: json.models.length });
  } catch (error) {
    renderModelOptions([], preferred);
    modelHint.textContent = error instanceof Error ? error.message : String(error);
    setStatus("Could not load models.", "error");
    sendLog("error", "models_failed", {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    modelRefresh.disabled = false;
    modelRefreshFooter.disabled = false;
  }
}

function applySettings(settings: Settings) {
  currentSettings = settings;
  providerSelect.value = settings.provider;
  maxTokens.value = String(settings.maxTokens);
  promptChat.value = settings.hotkeys.promptChat;
  promptPicker.value = settings.hotkeys.promptPicker;
  reloadHotkey.value = settings.hotkeys.reload;

  (Object.keys(apiKeyInputs) as Provider[]).forEach((provider) => {
    apiKeyInputs[provider].value = settings.apiKeys[provider];
  });

  renderModelOptions([settings.model], settings.model);
  modelHint.textContent = "Load the provider model list or keep the configured model as-is.";
  setStatus("Settings loaded.", "ok");
}

async function loadState() {
  if (!PORT) return;
  setStatus("Loading settings...", "loading");
  const res = await fetch(`http://localhost:${PORT}/state`);
  const settings = await res.json() as Settings;
  applySettings(settings);
  sendLog("info", "state_loaded", {
    provider: settings.provider,
    model: settings.model,
  });
}

async function save() {
  if (!PORT || !currentSettings) return;
  saveButton.disabled = true;
  setStatus("Saving settings...", "loading");
  const draft = getDraftSettings();

  try {
    const res = await fetch(`http://localhost:${PORT}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const next = await res.json() as Settings;
    if (!res.ok) {
      throw new Error("save failed");
    }
    applySettings(next);
    setStatus("Saved. Hotkeys and defaults updated.", "ok");
    sendLog("info", "save_succeeded", {
      provider: next.provider,
      model: next.model,
      maxTokens: next.maxTokens,
    });
  } catch (error) {
    setStatus("Could not save settings.", "error");
    sendLog("error", "save_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    saveButton.disabled = false;
  }
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
    const width = Math.max(640, Math.round(startWidth + (event.clientX - startX)));
    const height = Math.max(520, Math.round(startHeight + (event.clientY - startY)));
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

providerSelect.addEventListener("change", () => {
  modelHint.textContent = "Provider changed. Refresh models or save directly.";
  sendLog("info", "provider_changed", { provider: providerSelect.value });
});

modelRefresh.addEventListener("click", () => {
  void loadModels(modelSelect.value);
});

modelRefreshFooter.addEventListener("click", () => {
  void loadModels(modelSelect.value);
});

saveButton.addEventListener("click", () => {
  void save();
});

// ─── Titlebar close ─────────────────────────────────────────────────────────

document.getElementById("titlebar-close")?.addEventListener("click", () => {
  if (!PORT) return;
  sendLog("info", "close_requested");
  fetch(`http://localhost:${PORT}/close`, { method: "POST" }).catch(() => {});
});

void loadState();
initResizeGrip();
