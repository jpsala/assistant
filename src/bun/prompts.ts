/**
 * Prompt loader — reads from user data dir, watches for changes.
 *
 * Paths:
 *   User prompts : %APPDATA%/assistant/prompts/*.md  (writable)
 *   Starter prompts: Resources/starter-prompts/*.md  (bundled, read-only)
 *
 * On first run, starter prompts are seeded to the user directory.
 *
 * Prompt file format:
 *   @name:My Prompt
 *   @hotkey:Alt+Shift+T
 *   @hotkey:Alt+Shift+Q -> Alt+R   (chord)
 *   @provider:openai
 *   @model:gpt-4.1-mini
 *   @category:writing
 *   @confirm:true
 *
 *   System prompt body goes here...
 */

import { join, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { createLogger } from "./logger";

const log = createLogger("prompts");

// ─── Types ────────────────────────────────────────────────────────────────────

export type Provider = "openrouter" | "openai" | "anthropic" | "xai";

export type Prompt = {
  name: string;
  body: string;
  hotkey: string | null;
  provider: Provider | null;
  model: string | null;
  category: string | null;
  confirm: boolean;
  selectAllIfEmpty: boolean | null;
  filePath: string;
};

export type PromptMap = Map<string, Prompt>;
type ChangeCallback = (prompts: PromptMap) => void;

// ─── Paths ────────────────────────────────────────────────────────────────────

// import.meta.dir = .../Resources/app/bun/
// copy config targets go to Resources/app/ → one level up from bun/
const RESOURCES_APP_DIR = resolve(import.meta.dir, "..");

const STARTER_PROMPTS_DIR = join(RESOURCES_APP_DIR, "starter-prompts");

// User-writable data directory
const APPDATA = process.env.APPDATA ?? join(process.env.USERPROFILE ?? "~", "AppData", "Roaming");
export const USER_DATA_DIR = join(APPDATA, "assistant");
export const PROMPTS_DIR = join(USER_DATA_DIR, "prompts");

// ─── Parser ───────────────────────────────────────────────────────────────────

function parsePromptFile(filePath: string, content: string): Prompt {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);

  const meta: Record<string, string> = {};
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^@(\w+):(.*)$/);
    if (match) {
      meta[match[1].toLowerCase()] = match[2].trim();
      bodyStart = i + 1;
    } else if (line.trim() === "" && i === bodyStart) {
      bodyStart = i + 1;
    } else {
      bodyStart = i;
      break;
    }
  }

  const body = lines.slice(bodyStart).join("\n").trim();
  const stem = filePath.split(/[/\\]/).pop()!.replace(/\.md$/, "");

  return {
    name: meta["name"] ?? stem,
    body,
    hotkey: meta["hotkey"] ?? null,
    provider: (meta["provider"] as Provider) ?? null,
    model: meta["model"] ?? null,
    category: meta["category"] ?? null,
    confirm: meta["confirm"] === "true",
    selectAllIfEmpty: meta["selectallifempty"] === "true"
      ? true
      : meta["selectallifempty"] === "false"
        ? false
        : null,
    filePath,
  };
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

async function seedStarterPrompts(): Promise<void> {
  if (!existsSync(STARTER_PROMPTS_DIR)) return;

  const glob = new Bun.Glob("*.md");
  for await (const file of glob.scan(STARTER_PROMPTS_DIR)) {
    const dest = join(PROMPTS_DIR, file);
    if (!existsSync(dest)) {
      const src = join(STARTER_PROMPTS_DIR, file);
      await Bun.write(dest, Bun.file(src));
      log.info("seeded", { file });
    }
  }
}

// ─── Loader ───────────────────────────────────────────────────────────────────

async function loadAllPrompts(): Promise<PromptMap> {
  const map: PromptMap = new Map();
  if (!existsSync(PROMPTS_DIR)) return map;

  const glob = new Bun.Glob("*.md");
  for await (const file of glob.scan(PROMPTS_DIR)) {
    const filePath = join(PROMPTS_DIR, file);
    try {
      const content = await Bun.file(filePath).text();
      const prompt = parsePromptFile(filePath, content);
      map.set(prompt.name, prompt);
    } catch (e) {
      log.error("load_failed", { file, error: e });
    }
  }
  return map;
}

// ─── Watcher ──────────────────────────────────────────────────────────────────

let watcher: FSWatcher | null = null;
let debounceTimer: Timer | null = null;
let currentPrompts: PromptMap = new Map();

export async function initPrompts(onChange: ChangeCallback): Promise<PromptMap> {
  mkdirSync(PROMPTS_DIR, { recursive: true });

  // Seed starter prompts on first run
  await seedStarterPrompts();

  currentPrompts = await loadAllPrompts();
  onChange(currentPrompts);

  const reload = async () => {
    currentPrompts = await loadAllPrompts();
    log.info("reloaded", { promptCount: currentPrompts.size });
    onChange(currentPrompts);
  };

  watcher = watch(PROMPTS_DIR, { recursive: false }, (_event, _filename) => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(reload, 150);
  });

  log.info("loaded", {
    promptCount: currentPrompts.size,
    directory: PROMPTS_DIR,
  });
  return currentPrompts;
}

export function stopPrompts(): void {
  watcher?.close();
  watcher = null;
}

export function getPrompts(): PromptMap {
  return currentPrompts;
}

/** Write or update a prompt file */
export async function savePrompt(prompt: Prompt): Promise<string> {
  mkdirSync(PROMPTS_DIR, { recursive: true });

  const safeName = prompt.name.replace(/[<>:"/\\|?*]/g, "-");
  const filePath = prompt.filePath || join(PROMPTS_DIR, `${safeName}.md`);

  const lines: string[] = [`@name:${prompt.name}`];
  if (prompt.hotkey) lines.push(`@hotkey:${prompt.hotkey}`);
  if (prompt.provider) lines.push(`@provider:${prompt.provider}`);
  if (prompt.model) lines.push(`@model:${prompt.model}`);
  if (prompt.category) lines.push(`@category:${prompt.category}`);
  if (prompt.confirm) lines.push(`@confirm:true`);
  if (prompt.selectAllIfEmpty !== null) lines.push(`@selectallifempty:${prompt.selectAllIfEmpty}`);
  lines.push("", prompt.body);

  await Bun.write(filePath, lines.join("\n"));
  return filePath;
}

/** Delete a prompt file */
export async function deletePrompt(name: string): Promise<boolean> {
  const prompt = currentPrompts.get(name);
  if (!prompt || !existsSync(prompt.filePath)) return false;
  try {
    await rm(prompt.filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}
