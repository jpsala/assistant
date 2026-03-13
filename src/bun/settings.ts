/**
 * Settings — persistent config stored at %APPDATA%/assistant/settings.json
 *
 * Includes API keys, provider/model selection, system hotkeys, window sizes,
 * and max_tokens. Migrates API keys from .env on first run.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { USER_DATA_DIR } from "./prompts";
import type { Provider } from "./prompts";
import { createLogger } from "./logger";

const log = createLogger("settings");

// ─── Types ────────────────────────────────────────────────────────────────────

export type Settings = {
  // Provider & keys
  provider: Provider;
  model: string;
  apiKeys: Record<Provider, string>;
  maxTokens: number;
  feedbackStyle: "custom";
  startWithSystem: boolean;
  selectAllIfEmpty: boolean;

  // System hotkeys
  hotkeys: {
    promptChat: string;
    promptPicker: string;
    reload: string;
  };

  // Window sizes (persisted across sessions)
  windows: {
    chat: {
      x: number;
      y: number;
      w: number;
      h: number;
      contextTextHeight: number;
      composerHeight: number;
    };
    picker: { x: number; y: number; w: number; h: number };
    settings: { x: number; y: number; w: number; h: number };
    editor: { x: number; y: number; w: number; h: number };
    lab: { x: number; y: number; w: number; h: number };
  };

  // First-run flag
  onboarded: boolean;
};

const DEFAULTS: Settings = {
  provider: "openrouter",
  model: "anthropic/claude-sonnet-4-5",
  apiKeys: { openrouter: "", openai: "", anthropic: "", xai: "" },
  maxTokens: 8192,
  feedbackStyle: "custom",
  startWithSystem: false,
  selectAllIfEmpty: false,
  hotkeys: {
    promptChat: "Alt+Shift+W",
    promptPicker: "Alt+Shift+Space",
    reload: "",
  },
  windows: {
    chat: { x: 220, y: 120, w: 700, h: 600, contextTextHeight: 110, composerHeight: 92 },
    picker: { x: 320, y: 180, w: 640, h: 460 },
    settings: { x: 360, y: 120, w: 720, h: 640 },
    editor: { x: 280, y: 80, w: 760, h: 680 },
    lab: { x: 420, y: 140, w: 920, h: 640 },
  },
  onboarded: false,
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const SETTINGS_PATH = join(USER_DATA_DIR, "settings.json");

// In-memory cache
let _settings: Settings = structuredClone(DEFAULTS);

export function getSettings(): Settings {
  return _settings;
}

export async function loadSettings(): Promise<Settings> {
  // Migrate from .env on first load if settings.json doesn't exist
  if (!existsSync(SETTINGS_PATH)) {
    await migrateFromEnv();
  }

  try {
    const raw = await Bun.file(SETTINGS_PATH).text();
    const parsed = JSON.parse(raw);
    // Deep merge with defaults so new keys are always present
    _settings = deepMerge(DEFAULTS, parsed) as Settings;
  } catch {
    _settings = structuredClone(DEFAULTS);
  }

  if (_settings.feedbackStyle !== "custom") {
    _settings.feedbackStyle = "custom";
    await Bun.write(SETTINGS_PATH, JSON.stringify(_settings, null, 2));
  }

  return _settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  _settings = deepMerge(_settings, patch) as Settings;
  await Bun.write(SETTINGS_PATH, JSON.stringify(_settings, null, 2));
}

export async function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K]
): Promise<void> {
  await saveSettings({ [key]: value } as Partial<Settings>);
}

// ─── .env migration ───────────────────────────────────────────────────────────

async function migrateFromEnv(): Promise<void> {
  // Check common .env locations
  const envPaths = [
    join(import.meta.dir, "../../../../.env"), // project root in dev
    join(process.env.USERPROFILE ?? "", ".assistant.env"),
  ];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;

    try {
      const content = await Bun.file(envPath).text();
      const env = parseEnvFile(content);

      const patch: Partial<Settings> = {};

      if (env.OPENROUTER_KEY) {
        patch.apiKeys = { ...DEFAULTS.apiKeys, openrouter: env.OPENROUTER_KEY };
        patch.provider = "openrouter";
      }
      if (env.OPENAI_API_KEY) {
        patch.apiKeys = { ...(patch.apiKeys ?? DEFAULTS.apiKeys), openai: env.OPENAI_API_KEY };
      }
      if (env.ANTHROPIC_API_KEY) {
        patch.apiKeys = { ...(patch.apiKeys ?? DEFAULTS.apiKeys), anthropic: env.ANTHROPIC_API_KEY };
      }
      if (env.XAI_API_KEY) {
        patch.apiKeys = { ...(patch.apiKeys ?? DEFAULTS.apiKeys), xai: env.XAI_API_KEY };
      }
      if (env.AI_PROVIDER) {
        patch.provider = env.AI_PROVIDER as Provider;
      }
      if (env.DEFAULT_MODEL) {
        patch.model = env.DEFAULT_MODEL;
      }

      if (Object.keys(patch).length > 0) {
        _settings = deepMerge(DEFAULTS, patch) as Settings;
        log.info("migrated_from_env", { envPath });
      }
      break;
    } catch {
      // skip
    }
  }

  // Save (even if nothing migrated — creates the file)
  await Bun.write(SETTINGS_PATH, JSON.stringify(_settings, null, 2));
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    result[key] = val;
  }
  return result;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function deepMerge(base: unknown, patch: unknown): unknown {
  if (
    typeof base !== "object" ||
    base === null ||
    typeof patch !== "object" ||
    patch === null
  ) {
    return patch ?? base;
  }
  const result = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    result[k] = deepMerge(result[k], v);
  }
  return result;
}
