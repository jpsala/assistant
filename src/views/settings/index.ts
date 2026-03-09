type Provider = "openrouter" | "openai" | "anthropic" | "xai";

type Settings = {
  provider: Provider;
  model: string;
  apiKeys: Record<Provider, string>;
  maxTokens: number;
  hotkeys: {
    promptChat: string;
    promptPicker: string;
    reload: string;
  };
  windows: {
    chat: { w: number; h: number };
    picker: { w: number; h: number };
    settings: { w: number; h: number };
    editor: { w: number; h: number };
  };
  onboarded: boolean;
};

declare global {
  interface Window {
    __SETTINGS_PORT__?: number;
  }
}

const PORT = window.__SETTINGS_PORT__;

const providerSelect = document.getElementById("provider") as HTMLSelectElement;
const modelSelect = document.getElementById("model") as HTMLSelectElement;
const modelRefresh = document.getElementById("model-refresh") as HTMLButtonElement;
const modelHint = document.getElementById("model-hint")!;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const maxTokens = document.getElementById("maxTokens") as HTMLInputElement;
const promptChat = document.getElementById("promptChat") as HTMLInputElement;
const promptPicker = document.getElementById("promptPicker") as HTMLInputElement;
const reloadHotkey = document.getElementById("reloadHotkey") as HTMLInputElement;

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

providerSelect.addEventListener("change", () => {
  modelHint.textContent = "Provider changed. Refresh models or save directly.";
  sendLog("info", "provider_changed", { provider: providerSelect.value });
});

modelRefresh.addEventListener("click", () => {
  void loadModels(modelSelect.value);
});

saveButton.addEventListener("click", () => {
  void save();
});

void loadState();
