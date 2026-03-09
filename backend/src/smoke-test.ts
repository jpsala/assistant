import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempRoot = await mkdtemp(join(tmpdir(), "ai-assistant-backend-"));
const settingsFile = join(tempRoot, "settings.conf");
const modelFile = join(tempRoot, "model.conf");
const envFile = join(tempRoot, ".env");
const promptsDir = join(tempRoot, "prompts");
const dataDir = join(tempRoot, "data");
const port = "8767";

async function setupFixtures() {
  await mkdir(promptsDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    envFile,
    [
      "OPENROUTER_KEY=test-openrouter-key",
      "OPENAI_API_KEY=test-openai-key",
      "ANTHROPIC_API_KEY=test-anthropic-key",
      "XAI_API_KEY=test-xai-key",
      "AI_PROVIDER=openrouter",
      "DEFAULT_MODEL=anthropic/claude-sonnet-4-5",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    settingsFile,
    [
      "provider=openrouter",
      "model_openrouter=google/gemini-test",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(promptsDir, "hello-world.md"),
    ["@name:Hello world", "@provider:openrouter", "", "Say hello."].join("\n"),
    "utf8",
  );
}

async function waitForHealth(baseUrl: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error("Backend did not become healthy");
}

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as any).error || `HTTP ${response.status}`);
  }
  return payload as any;
}

await setupFixtures();

const proc = Bun.spawn({
  cmd: ["bun", "backend/src/index.ts"],
  cwd: join(import.meta.dir, "..", ".."),
  env: {
    ...process.env,
    AI_ASSISTANT_BACKEND_PORT: port,
    AI_ASSISTANT_SETTINGS_FILE: settingsFile,
    AI_ASSISTANT_MODEL_FILE: modelFile,
    AI_ASSISTANT_ENV_FILE: envFile,
    AI_ASSISTANT_PROMPTS_DIR: promptsDir,
    AI_ASSISTANT_DATA_DIR: dataDir,
  },
  stdout: "pipe",
  stderr: "pipe",
});

try {
  await waitForHealth(`http://127.0.0.1:${port}`);

  const settingsBefore = await requestJson("/v1/settings");
  const providerSaved = await requestJson("/v1/settings/provider", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "openai" }),
  });
  const modelSaved = await requestJson("/v1/settings/model", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "openai", model: "gpt-4.1-mini" }),
  });

  const promptsBefore = await requestJson("/v1/prompts");
  const promptSaved = await requestJson("/v1/prompts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      oldName: "",
      name: "Smoke Prompt",
      prompt: "Return only OK",
      provider: "openai",
      model: "gpt-4.1-mini",
      hotkey: "!+k",
      confirm: true,
    }),
  });
  const promptDeleted = await requestJson(`/v1/prompts/${encodeURIComponent("Smoke Prompt")}`, {
    method: "DELETE",
  });

  const conversationSaved = await requestJson("/v1/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "smoke-conversation",
      original: "original text",
      provider: "openai",
      providerLabel: "OpenAI",
      model: "gpt-4.1-mini",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ],
    }),
  });
  const conversations = await requestJson("/v1/conversations");
  const loadedConversation = await requestJson("/v1/conversations/smoke-conversation");

  const settingsFileContent = await readFile(settingsFile, "utf8");
  console.log(
    JSON.stringify({
      ok: true,
      settingsBeforeProvider: settingsBefore.provider,
      settingsAfterProvider: providerSaved.provider,
      settingsAfterModel: modelSaved.currentModel,
      promptsBeforeCount: promptsBefore.prompts.length,
      promptSavedName: promptSaved.prompt?.name,
      promptDeleteResult: promptDeleted.deleted,
      conversationSavedId: conversationSaved.id,
      recentConversationCount: conversations.conversations.length,
      loadedConversationMessages: loadedConversation.messages.length,
      settingsFileHasProvider: settingsFileContent.includes("provider=openai"),
    }),
  );
} finally {
  proc.kill();
  await proc.exited;
  await rm(tempRoot, { recursive: true, force: true });
}
