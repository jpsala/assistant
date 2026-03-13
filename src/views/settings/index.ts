import { mountWindowShell, sendWindowLog } from "../framework/window-shell";

type Provider = "openrouter" | "openai" | "anthropic" | "xai";

type Settings = {
  provider: Provider;
  model: string;
  apiKeys: Record<Provider, string>;
  maxTokens: number;
  feedbackStyle: "custom";
  startWithSystem: boolean;
  selectAllIfEmpty: boolean;
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
  }
}

const PORT = window.__SETTINGS_PORT__;

const shell = mountWindowShell({
  title: "Settings",
  subtitle: "system preferences",
  showIcon: true,
  showActionBar: true,
  showStatusBar: true,
  minWidth: 640,
  minHeight: 520,
});

const style = document.createElement("style");
style.textContent = `
  .settings-root {
    max-width: 980px;
    margin: 0 auto;
    display: grid;
    gap: 18px;
  }
  .settings-hero {
    display: grid;
    gap: 6px;
  }
  .settings-eyebrow {
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ws-accent);
    font-weight: 700;
  }
  .settings-title {
    margin: 0;
    font-size: clamp(28px, 4vw, 40px);
    line-height: 1;
    font-weight: 700;
    color: #f5f7ff;
  }
  .settings-sub {
    max-width: 720px;
    color: var(--ws-text-muted);
    font-size: 14px;
    line-height: 1.5;
  }
  .settings-grid {
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 18px;
  }
  .settings-card {
    padding: 18px;
    border: 1px solid var(--ws-border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--ws-bg-elevated) 84%, var(--ws-bg) 16%);
  }
  .settings-card h2 {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 700;
    color: #f5f7ff;
  }
  .settings-card p {
    margin: 0 0 16px;
    color: var(--ws-text-muted);
    font-size: 13px;
    line-height: 1.45;
  }
  .settings-field {
    display: grid;
    gap: 6px;
    margin-bottom: 14px;
  }
  .settings-field label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ws-text-muted);
  }
  .settings-inline-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 500;
    color: var(--ws-text);
    text-transform: none;
    letter-spacing: 0;
  }
  .settings-inline-toggle input {
    width: auto;
  }
  .settings-input,
  .settings-select,
  .settings-button {
    font: inherit;
  }
  .settings-input,
  .settings-select {
    width: 100%;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--ws-border) 72%, transparent 28%);
    background: color-mix(in srgb, var(--ws-bg-muted) 82%, transparent 18%);
    color: var(--ws-text);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .settings-input:focus,
  .settings-select:focus {
    border-color: color-mix(in srgb, var(--ws-accent) 70%, white 30%);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ws-accent) 18%, transparent 82%);
  }
  .settings-select option {
    background: #1e2035;
    color: var(--ws-text);
  }
  .settings-inline {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: end;
  }
  .settings-key-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .settings-hint {
    font-size: 12px;
    color: var(--ws-text-muted);
  }
  .settings-debug-panel {
    margin-top: 8px;
    padding: 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--ws-bg-muted) 78%, transparent 22%);
    border: 1px solid color-mix(in srgb, var(--ws-border) 72%, transparent 28%);
    font-family: Consolas, "Fira Mono", monospace;
    font-size: 12px;
    color: color-mix(in srgb, var(--ws-text) 72%, white 28%);
    white-space: pre-wrap;
  }
  .settings-code {
    font-family: Consolas, "Fira Mono", monospace;
    font-size: 12px;
    padding: 2px 5px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--ws-bg-muted) 84%, transparent 16%);
    color: color-mix(in srgb, var(--ws-text) 72%, white 28%);
  }
  .settings-button {
    border: 1px solid color-mix(in srgb, var(--ws-border) 72%, transparent 28%);
    border-radius: 10px;
    padding: 10px 18px;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    background: var(--ws-accent);
    color: white;
  }
  .settings-button:hover {
    filter: brightness(1.05);
  }
  .settings-button.secondary {
    background: color-mix(in srgb, var(--ws-bg-muted) 82%, transparent 18%);
    color: var(--ws-text);
  }
  .settings-button.secondary:hover {
    background: color-mix(in srgb, var(--ws-bg-muted) 92%, transparent 8%);
  }
  .settings-button:disabled {
    opacity: 0.4;
    cursor: default;
    filter: none;
  }
  .settings-status {
    font-size: 13px;
    color: var(--ws-text-muted);
  }
  .settings-status[data-kind="ok"] { color: #3ddc97; }
  .settings-status[data-kind="error"] { color: #ef4444; }
  .settings-status[data-kind="loading"] { color: #f59e0b; }
  .settings-actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  @media (max-width: 860px) {
    .settings-grid {
      grid-template-columns: 1fr;
    }
    .settings-key-grid {
      grid-template-columns: 1fr;
    }
  }
`;
document.head.appendChild(style);

shell.content.innerHTML = `
  <div class="settings-root">
    <div class="settings-hero">
      <div class="settings-eyebrow">Assistant</div>
      <h1 class="settings-title">Settings</h1>
      <div class="settings-sub">
        Change your default provider, choose a model, rotate API keys, and tune hotkeys without restarting the app.
      </div>
    </div>

    <div class="settings-grid">
      <section class="settings-card">
        <h2>Model Defaults</h2>
        <p>Used whenever a prompt does not override provider or model.</p>

        <div class="settings-field">
          <label for="provider">Provider</label>
          <select class="settings-select" id="provider">
            <option value="openrouter">OpenRouter</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="xai">xAI</option>
          </select>
        </div>

        <div class="settings-field">
          <label for="model">Model</label>
          <div class="settings-inline">
            <select class="settings-select" id="model"></select>
            <button class="settings-button secondary" id="model-refresh" type="button">Refresh</button>
          </div>
          <div class="settings-hint" id="model-hint">Load provider models when you are ready.</div>
        </div>

        <div class="settings-field">
          <label for="maxTokens">Max Tokens</label>
          <input class="settings-input" id="maxTokens" type="number" min="1" step="1" />
        </div>
      </section>

      <section class="settings-card">
        <h2>System Hotkeys</h2>
        <p>Friendly format like <span class="settings-code">Alt+Shift+Space</span> is supported.</p>

        <div class="settings-field">
          <label for="promptChat">Prompt Chat</label>
          <input class="settings-input" id="promptChat" type="text" />
        </div>

        <div class="settings-field">
          <label for="promptPicker">Prompt Picker</label>
          <input class="settings-input" id="promptPicker" type="text" />
        </div>

        <div class="settings-field">
          <label for="reloadHotkey">Reload</label>
          <input class="settings-input" id="reloadHotkey" type="text" />
        </div>

        <div class="settings-field">
          <label>Hotkey Debug</label>
          <div class="settings-hint">Shows the active registrations currently seen by Bun.</div>
          <div class="settings-debug-panel" id="hotkey-debug">Loading hotkey registry...</div>
        </div>

        <div class="settings-field">
          <label for="startWithSystem">Launch on Login</label>
          <label class="settings-inline-toggle">
            <input id="startWithSystem" type="checkbox" />
            Start Assistant automatically when Windows signs in
          </label>
        </div>

        <div class="settings-field">
          <label for="selectAllIfEmpty">Select All if Empty</label>
          <label class="settings-inline-toggle">
            <input id="selectAllIfEmpty" type="checkbox" />
            If no text is selected, select all before running the prompt
          </label>
        </div>
      </section>
    </div>

    <section class="settings-card">
      <h2>API Keys</h2>
      <p>Keys stay local in your roaming app data settings file.</p>

      <div class="settings-key-grid">
        <div class="settings-field">
          <label for="key-openrouter">OpenRouter</label>
          <input class="settings-input" id="key-openrouter" type="password" autocomplete="off" />
        </div>
        <div class="settings-field">
          <label for="key-openai">OpenAI</label>
          <input class="settings-input" id="key-openai" type="password" autocomplete="off" />
        </div>
        <div class="settings-field">
          <label for="key-anthropic">Anthropic</label>
          <input class="settings-input" id="key-anthropic" type="password" autocomplete="off" />
        </div>
        <div class="settings-field">
          <label for="key-xai">xAI</label>
          <input class="settings-input" id="key-xai" type="password" autocomplete="off" />
        </div>
      </div>
    </section>
  </div>
`;

const providerSelect = document.getElementById("provider") as HTMLSelectElement;
const modelSelect = document.getElementById("model") as HTMLSelectElement;
const modelRefresh = document.getElementById("model-refresh") as HTMLButtonElement;
const modelHint = document.getElementById("model-hint") as HTMLElement;
const maxTokens = document.getElementById("maxTokens") as HTMLInputElement;
const promptChat = document.getElementById("promptChat") as HTMLInputElement;
const promptPicker = document.getElementById("promptPicker") as HTMLInputElement;
const reloadHotkey = document.getElementById("reloadHotkey") as HTMLInputElement;
const startWithSystem = document.getElementById("startWithSystem") as HTMLInputElement;
const selectAllIfEmpty = document.getElementById("selectAllIfEmpty") as HTMLInputElement;
const hotkeyDebug = document.getElementById("hotkey-debug") as HTMLElement;

const apiKeyInputs: Record<Provider, HTMLInputElement> = {
  openrouter: document.getElementById("key-openrouter") as HTMLInputElement,
  openai: document.getElementById("key-openai") as HTMLInputElement,
  anthropic: document.getElementById("key-anthropic") as HTMLInputElement,
  xai: document.getElementById("key-xai") as HTMLInputElement,
};

const statusEl = document.createElement("span");
statusEl.className = "settings-status";
statusEl.dataset.kind = "idle";
shell.statusLeft.replaceChildren(statusEl);
shell.statusRight.textContent = "Settings";
shell.actionbarCopy.textContent = "Models and API keys apply across all prompt windows.";

const footerRefresh = document.createElement("button");
footerRefresh.className = "settings-button secondary";
footerRefresh.type = "button";
footerRefresh.id = "model-refresh-footer";
footerRefresh.textContent = "Refresh Models";

const saveButton = document.createElement("button");
saveButton.className = "settings-button";
saveButton.type = "button";
saveButton.id = "save";
saveButton.textContent = "Save Changes";

shell.actionbarActions.classList.add("settings-actions");
shell.actionbarActions.append(footerRefresh, saveButton);

let currentSettings: Settings | null = null;
let currentModels: string[] = [];

function setStatus(message: string, kind: "idle" | "ok" | "error" | "loading" = "idle") {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
}

function sendLog(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  meta: Record<string, unknown> = {},
) {
  sendWindowLog(PORT, level, event, meta);
}

async function refreshHotkeyDebug() {
  if (!PORT) return;
  try {
    const res = await fetch(`http://localhost:${PORT}/hotkeys/debug`);
    const json = await res.json() as {
      registered: Array<{ name: string; spec: string; normalized: string; kind: string }>;
    };
    if (json.registered.length === 0) {
      hotkeyDebug.textContent = "No active hotkeys registered.";
      return;
    }
    hotkeyDebug.textContent = json.registered
      .map((entry) => `${entry.name}  ${entry.normalized}  [${entry.kind}]`)
      .join("\n");
  } catch {
    hotkeyDebug.textContent = "Could not load hotkey registry.";
  }
}

function getDraftSettings(): Settings {
  if (!currentSettings) throw new Error("settings not loaded");
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
    startWithSystem: startWithSystem.checked,
    selectAllIfEmpty: selectAllIfEmpty.checked,
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
  footerRefresh.disabled = true;

  try {
    if (!PORT) throw new Error("missing settings port");
    const res = await fetch(`http://localhost:${PORT}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey }),
    });
    const json = await res.json() as { models: string[]; error?: string };
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
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
    footerRefresh.disabled = false;
  }
}

function applySettings(settings: Settings) {
  currentSettings = settings;
  providerSelect.value = settings.provider;
  maxTokens.value = String(settings.maxTokens);
  promptChat.value = settings.hotkeys.promptChat;
  promptPicker.value = settings.hotkeys.promptPicker;
  reloadHotkey.value = settings.hotkeys.reload;
  startWithSystem.checked = Boolean(settings.startWithSystem);
  selectAllIfEmpty.checked = Boolean(settings.selectAllIfEmpty);

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
    const next = await res.json() as Settings & { error?: string };
    if (!res.ok) throw new Error(next.error || "save failed");
    applySettings(next);
    await refreshHotkeyDebug();
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

modelRefresh.addEventListener("click", () => { void loadModels(modelSelect.value); });
footerRefresh.addEventListener("click", () => { void loadModels(modelSelect.value); });
saveButton.addEventListener("click", () => { void save(); });

void loadState();
void refreshHotkeyDebug();
