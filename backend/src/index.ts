import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { watch as watchFs } from "node:fs";
import { join, resolve } from "node:path";

type Provider = "openrouter" | "openai" | "anthropic" | "xai";

type PromptRecord = {
  name: string;
  prompt: string;
  provider: string;
  model: string;
  hotkey: string;
  confirm: boolean;
  path: string;
  updatedAt: string;
};

type ConversationSnapshot = {
  id?: string;
  original?: string;
  provider?: string;
  providerLabel?: string;
  model?: string;
  messages?: Array<{
    role: string;
    content: string;
    label?: string;
    providerLabel?: string;
    model?: string;
  }>;
  updatedAt?: string;
};

const ROOT_DIR = resolve(import.meta.dir, "..", "..");
const SETTINGS_FILE = join(ROOT_DIR, "settings.conf");
const ENV_FILE = join(ROOT_DIR, ".env");
const PROMPTS_DIR = join(ROOT_DIR, "prompts");
const DATA_DIR = join(ROOT_DIR, "data");
const CONVERSATIONS_DIR = join(DATA_DIR, "conversations");
const PORT = Number(process.env.AI_ASSISTANT_BACKEND_PORT || "8765");
const HOST = process.env.AI_ASSISTANT_BACKEND_HOST || "127.0.0.1";
const VALID_PROVIDERS: Provider[] = ["openrouter", "openai", "anthropic", "xai"];
const DEFAULT_PROVIDER: Provider = "openrouter";
const DEFAULT_MODELS: Record<Provider, string> = {
  openrouter: "anthropic/claude-sonnet-4-5",
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest",
  xai: "grok-3-mini",
};

const promptWatchClients = new Set<ReadableStreamDefaultController<string>>();

function providerLabel(provider: string): string {
  switch (provider) {
    case "openrouter":
      return "OpenRouter";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "xai":
      return "xAI";
    default:
      return provider;
  }
}

function normalizeProvider(provider: unknown): Provider {
  const value = String(provider || "").trim().toLowerCase() as Provider;
  return VALID_PROVIDERS.includes(value) ? value : DEFAULT_PROVIDER;
}

function detectLanguage(text: string): "es" | "en" {
  if (/[áéíóúñü¿¡]/i.test(text)) {
    return "es";
  }

  const lower = ` ${text.toLowerCase()} `;
  const spanishWords = [
    " que ",
    " una ",
    " para ",
    " pero ",
    " como ",
    " esto ",
    " con ",
    " por ",
    " los ",
    " las ",
    " del ",
    " tiene ",
    " hace ",
    " está ",
  ];

  const count = spanishWords.reduce((acc, word) => acc + (lower.includes(word) ? 1 : 0), 0);
  return count >= 2 ? "es" : "en";
}

function getSystemPrompt(mode: "fix" | "write", lang: "es" | "en"): string {
  const styleEs =
    "Escribi en el estilo natural de JP, un developer argentino. Reglas:" +
    "\n- Usa voseo argentino: vos, tenes, fijate, recorda, contame, hace" +
    "\n- Mezcla espanol e ingles tecnico de forma natural (PR, bug, deploy, back-end, booking)" +
    "\n- Tono conversacional, como explicando en persona. Directo pero no rudo." +
    "\n- Varia la estructura: no siempre abrir/cerrar igual" +
    "\n- NO uses 'tu' ni 'usted' - siempre 'vos'" +
    "\n- NO suenes a LLM" +
    "\n- Podes usar parentesis para aclarar, agregar info con 'Y algo que...' u 'Otra cosa...'";

  const styleEn =
    "Write in JP's natural English style. JP is an Argentine developer, non-native English speaker. Rules:" +
    "\n- Non-native but fluent English - do NOT over-polish for native fluency" +
    "\n- Keep his original words as much as possible" +
    "\n- Conversational and direct tone" +
    "\n- Only fix what's clearly wrong (grammar, spelling)" +
    "\n- Do NOT rewrite for elegance, fluency, or corporate tone" +
    "\n- Do NOT sound like an LLM";

  const taskFix =
    lang === "es"
      ? "Corregi la gramatica, ortografia y claridad del siguiente texto. Mantené el significado y el estilo intactos. Devolve SOLO el texto corregido, sin explicaciones."
      : "Fix the grammar, spelling, and clarity of the following text. Keep the original meaning and voice intact. Return ONLY the corrected text, no explanations.";

  const taskWrite =
    lang === "es"
      ? "Escribi un mensaje o texto basado en las siguientes instrucciones. Devolve SOLO el texto escrito, sin explicaciones ni meta-comentarios."
      : "Write a message or text based on the following instructions. Return ONLY the written text, no explanations or meta-commentary.";

  return `${lang === "es" ? styleEs : styleEn}\n\n${mode === "fix" ? taskFix : taskWrite}`;
}

async function readKeyValueFile(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(filePath, "utf8");
    const result: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const eqIndex = line.indexOf("=");
      if (eqIndex <= 0) {
        continue;
      }
      result[line.slice(0, eqIndex).trim()] = line.slice(eqIndex + 1).trim();
    }
    return result;
  } catch {
    return {};
  }
}

async function loadConfig() {
  const env = await readKeyValueFile(ENV_FILE);
  const settings = await readKeyValueFile(SETTINGS_FILE);

  const provider = normalizeProvider(settings.provider || env.AI_PROVIDER || DEFAULT_PROVIDER);
  const keys = {
    openrouter: (settings.api_key_openrouter || env.OPENROUTER_KEY || "").trim(),
    openai: (settings.api_key_openai || env.OPENAI_API_KEY || "").trim(),
    anthropic: (settings.api_key_anthropic || env.ANTHROPIC_API_KEY || "").trim(),
    xai: (settings.api_key_xai || env.XAI_API_KEY || "").trim(),
  };

  return {
    env,
    settings,
    keys,
    provider,
    maxTokens: Number(settings.max_tokens || "8192") || 8192,
  };
}

function modelForProvider(settings: Record<string, string>, env: Record<string, string>, provider: Provider): string {
  return (
    settings[`model_${provider}`] ||
    (provider === "openrouter" ? env.DEFAULT_MODEL : "") ||
    DEFAULT_MODELS[provider]
  ).trim();
}

function buildChatUrl(provider: Provider): string {
  switch (provider) {
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
    case "anthropic":
      return "https://api.anthropic.com/v1/messages";
    case "xai":
      return "https://api.x.ai/v1/chat/completions";
  }
}

function buildModelsUrl(provider: Provider): string {
  switch (provider) {
    case "openrouter":
      return "https://openrouter.ai/api/v1/models";
    case "openai":
      return "https://api.openai.com/v1/models";
    case "anthropic":
      return "https://api.anthropic.com/v1/models";
    case "xai":
      return "https://api.x.ai/v1/models";
  }
}

function providerHeaders(provider: Provider, apiKey: string): HeadersInit {
  switch (provider) {
    case "openrouter":
      return {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ai-assistant.local",
        "X-Title": "AI Assistant",
      };
    case "openai":
    case "xai":
      return {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
    case "anthropic":
      return {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      };
  }
}

function buildPayload(
  provider: Provider,
  systemPrompt: string,
  userMessage: string,
  model: string,
  maxTokens: number,
  stream = false,
) {
  if (provider === "anthropic") {
    return {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      stream,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    };
  }

  return {
    model,
    max_tokens: maxTokens,
    stream,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  };
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
      "access-control-allow-headers": "content-type",
      ...(init.headers || {}),
    },
  });
}

function sseEvent(data: unknown, event?: string): string {
  const eventLine = event ? `event: ${event}\n` : "";
  return `${eventLine}data: ${JSON.stringify(data)}\n\n`;
}

async function requestBody<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function extractAssistantContent(provider: Provider, payload: any): string {
  if (provider === "anthropic") {
    const content = Array.isArray(payload?.content) ? payload.content : [];
    return content
      .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
      .map((part: any) => part.text)
      .join("")
      .trim();
  }

  const choice = payload?.choices?.[0];
  const messageContent = choice?.message?.content;
  if (typeof messageContent === "string") {
    return messageContent.trim();
  }
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function extractDelta(provider: Provider, payload: any): string {
  if (provider === "anthropic") {
    return typeof payload?.delta?.text === "string" ? payload.delta.text : "";
  }
  const delta = payload?.choices?.[0]?.delta?.content;
  if (typeof delta === "string") {
    return delta;
  }
  if (Array.isArray(delta)) {
    return delta
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

async function callProvider(body: {
  provider?: string;
  model?: string;
  systemPrompt: string;
  userMessage: string;
}): Promise<{ content: string; provider: Provider; providerLabel: string; model: string }> {
  const config = await loadConfig();
  const provider = normalizeProvider(body.provider || config.provider);
  const apiKey = config.keys[provider];

  if (!apiKey) {
    throw new Error(`Missing API key for ${providerLabel(provider)}`);
  }

  const model = String(body.model || modelForProvider(config.settings, config.env, provider) || "").trim();
  const response = await fetch(buildChatUrl(provider), {
    method: "POST",
    headers: providerHeaders(provider, apiKey),
    body: JSON.stringify(buildPayload(provider, body.systemPrompt, body.userMessage, model, config.maxTokens, false)),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const content = extractAssistantContent(provider, payload);
  if (!content) {
    throw new Error("Provider response did not contain assistant content");
  }

  return {
    content,
    provider,
    providerLabel: providerLabel(provider),
    model,
  };
}

async function streamProvider(
  body: {
    provider?: string;
    model?: string;
    systemPrompt: string;
    userMessage: string;
  },
): Promise<ReadableStream<string>> {
  const config = await loadConfig();
  const provider = normalizeProvider(body.provider || config.provider);
  const apiKey = config.keys[provider];
  if (!apiKey) {
    throw new Error(`Missing API key for ${providerLabel(provider)}`);
  }

  const model = String(body.model || modelForProvider(config.settings, config.env, provider) || "").trim();
  const upstream = await fetch(buildChatUrl(provider), {
    method: "POST",
    headers: providerHeaders(provider, apiKey),
    body: JSON.stringify(buildPayload(provider, body.systemPrompt, body.userMessage, model, config.maxTokens, true)),
  });

  if (!upstream.ok || !upstream.body) {
    throw new Error(`HTTP ${upstream.status}: ${await upstream.text()}`);
  }

  const textDecoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

  return new ReadableStream<string>({
    async start(controller) {
      controller.enqueue(
        sseEvent({ provider, providerLabel: providerLabel(provider), model }, "start"),
      );

      const reader = upstream.body!.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += textDecoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const dataLines = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());

          for (const rawData of dataLines) {
            if (!rawData || rawData === "[DONE]") {
              continue;
            }
            let parsed: any;
            try {
              parsed = JSON.parse(rawData);
            } catch {
              continue;
            }

            const delta = extractDelta(provider, parsed);
            if (!delta) {
              continue;
            }

            fullContent += delta;
            controller.enqueue(sseEvent({ delta }, "delta"));
          }
        }
      }

      controller.enqueue(sseEvent({ content: fullContent, provider, providerLabel: providerLabel(provider), model }, "done"));
      controller.close();
    },
  });
}

async function fetchModels(providerInput?: string) {
  const config = await loadConfig();
  const provider = normalizeProvider(providerInput || config.provider);
  const apiKey = config.keys[provider];
  if (!apiKey) {
    throw new Error(`Missing API key for ${providerLabel(provider)}`);
  }

  const response = await fetch(buildModelsUrl(provider), {
    headers: providerHeaders(provider, apiKey),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const payload: any = await response.json();
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.map((item: any) => ({
    id: String(item?.id || ""),
    name: String(item?.name || item?.display_name || item?.id || ""),
  }));
}

async function listPrompts(): Promise<PromptRecord[]> {
  const entries = await readdir(PROMPTS_DIR, { withFileTypes: true }).catch(() => []);
  const prompts: PromptRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }

    const filePath = join(PROMPTS_DIR, entry.name);
    const content = await readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    let name = "";
    let provider = "";
    let model = "";
    let hotkey = "";
    let confirm = false;
    let bodyStart = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      const lower = line.toLowerCase();
      if (lower.startsWith("@name:")) {
        name = line.slice(6).trim();
        bodyStart = index + 1;
        continue;
      }
      if (lower.startsWith("@provider:")) {
        provider = line.slice(10).trim();
        bodyStart = index + 1;
        continue;
      }
      if (lower.startsWith("@model:")) {
        model = line.slice(7).trim();
        bodyStart = index + 1;
        continue;
      }
      if (lower.startsWith("@hotkey:")) {
        hotkey = line.slice(8).trim();
        bodyStart = index + 1;
        continue;
      }
      if (lower.startsWith("@confirm:")) {
        confirm = /^(1|true|yes|on)$/i.test(line.slice(9).trim());
        bodyStart = index + 1;
        continue;
      }
      break;
    }

    if (!name) {
      continue;
    }

    const fileStat = await stat(filePath);
    prompts.push({
      name,
      prompt: lines.slice(bodyStart).join("\n").trim(),
      provider,
      model,
      hotkey,
      confirm,
      path: filePath,
      updatedAt: fileStat.mtime.toISOString(),
    });
  }

  prompts.sort((left, right) => left.name.localeCompare(right.name));
  return prompts;
}

async function saveConversation(snapshot: ConversationSnapshot) {
  await mkdir(CONVERSATIONS_DIR, { recursive: true });
  const id = (snapshot.id || crypto.randomUUID()).trim();
  const payload = {
    ...snapshot,
    id,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(join(CONVERSATIONS_DIR, `${id}.json`), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

async function loadConversation(id: string) {
  const content = await readFile(join(CONVERSATIONS_DIR, `${id}.json`), "utf8");
  return JSON.parse(content);
}

async function loadRecentConversations(limit = 20) {
  const entries = await readdir(CONVERSATIONS_DIR, { withFileTypes: true }).catch(() => []);
  const records: Array<{
    id: string;
    updatedAt: string;
    original: string;
    model: string;
    providerLabel: string;
    messageCount: number;
    latestAssistant: string;
  }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const filePath = join(CONVERSATIONS_DIR, entry.name);
    const content = JSON.parse(await readFile(filePath, "utf8"));
    const messages = Array.isArray(content.messages) ? content.messages : [];
    const latestAssistant =
      [...messages].reverse().find((message: any) => message?.role === "assistant" && typeof message?.content === "string")
        ?.content || "";
    records.push({
      id: content.id,
      updatedAt: content.updatedAt || "",
      original: content.original || "",
      model: content.model || "",
      providerLabel: content.providerLabel || "",
      messageCount: messages.length,
      latestAssistant,
    });
  }

  records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return records.slice(0, limit);
}

function buildPromptChatRequest(body: { transcript: string; provider?: string; model?: string }) {
  const transcript = String(body.transcript || "").trim();
  const lang = detectLanguage(transcript);
  const systemPrompt =
    getSystemPrompt("fix", lang) +
    "\n\nYou are continuing a chat conversation." +
    "\nThe user message contains structured context with labels like ORIGINAL TEXT, CONVERSATION, User, and Assistant." +
    "\nThose labels are metadata for you, not text to rewrite or repeat." +
    "\nAnswer only the latest user turn." +
    "\nDo not quote, summarize, or reproduce the full transcript unless the user explicitly asks for that." +
    "\nDo not include labels like ORIGINAL TEXT, CONVERSATION, User, or Assistant in your reply." +
    "\nReturn only the assistant reply text.";

  const userMessage =
    "Use the transcript below only as conversation context.\n\n" +
    "Reply to the latest user message only.\n\n" +
    "=== TRANSCRIPT START ===\n" +
    transcript +
    "\n=== TRANSCRIPT END ===";

  return {
    provider: body.provider,
    model: body.model,
    systemPrompt,
    userMessage,
  };
}

function startPromptWatcher() {
  watchFs(PROMPTS_DIR, { persistent: true }, async () => {
    const prompts = await listPrompts().catch(() => []);
    const payload = sseEvent({ prompts }, "prompts");
    for (const client of promptWatchClients) {
      try {
        client.enqueue(payload);
      } catch {
        promptWatchClients.delete(client);
      }
    }
  });
}

function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return optionsResponse();
  }

  if (url.pathname === "/health") {
    return json({ ok: true, port: PORT });
  }

  if (url.pathname === "/v1/config" && request.method === "GET") {
    const config = await loadConfig();
    return json({
      provider: config.provider,
      providerLabel: providerLabel(config.provider),
      model: modelForProvider(config.settings, config.env, config.provider),
      backendUrl: `http://${HOST}:${PORT}`,
    });
  }

  if (url.pathname === "/v1/models" && request.method === "GET") {
    try {
      const models = await fetchModels(url.searchParams.get("provider") || undefined);
      return json({ models });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  if (url.pathname === "/v1/chat" && request.method === "POST") {
    try {
      const body = await requestBody<{
        provider?: string;
        model?: string;
        systemPrompt?: string;
        userMessage?: string;
        kind?: string;
        transcript?: string;
      }>(request);

      const payload =
        body.kind === "prompt-chat"
          ? buildPromptChatRequest({ transcript: body.transcript || "", provider: body.provider, model: body.model })
          : {
              provider: body.provider,
              model: body.model,
              systemPrompt: String(body.systemPrompt || ""),
              userMessage: String(body.userMessage || ""),
            };

      const result = await callProvider(payload);
      return json(result);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  if (url.pathname === "/v1/chat/stream" && request.method === "POST") {
    try {
      const body = await requestBody<{
        provider?: string;
        model?: string;
        systemPrompt?: string;
        userMessage?: string;
        kind?: string;
        transcript?: string;
      }>(request);

      const payload =
        body.kind === "prompt-chat"
          ? buildPromptChatRequest({ transcript: body.transcript || "", provider: body.provider, model: body.model })
          : {
              provider: body.provider,
              model: body.model,
              systemPrompt: String(body.systemPrompt || ""),
              userMessage: String(body.userMessage || ""),
            };

      const stream = await streamProvider(payload);
      return new Response(stream.pipeThrough(new TextEncoderStream()), {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "access-control-allow-origin": "*",
        },
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  if (url.pathname === "/v1/prompts" && request.method === "GET") {
    return json({ prompts: await listPrompts() });
  }

  if (url.pathname === "/v1/prompts/watch" && request.method === "GET") {
    const stream = new ReadableStream<string>({
      async start(controller) {
        promptWatchClients.add(controller);
        controller.enqueue(sseEvent({ prompts: await listPrompts().catch(() => []) }, "prompts"));
      },
      cancel(controller) {
        promptWatchClients.delete(controller as ReadableStreamDefaultController<string>);
      },
    });

    return new Response(stream.pipeThrough(new TextEncoderStream()), {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
      },
    });
  }

  if (url.pathname === "/v1/conversations" && request.method === "GET") {
    return json({ conversations: await loadRecentConversations() });
  }

  if (url.pathname === "/v1/conversations" && request.method === "POST") {
    try {
      const body = await requestBody<ConversationSnapshot>(request);
      return json(await saveConversation(body));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  if (url.pathname.startsWith("/v1/conversations/") && request.method === "GET") {
    const id = decodeURIComponent(url.pathname.slice("/v1/conversations/".length));
    try {
      return json(await loadConversation(id));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
    }
  }

  return json({ error: "Not found" }, { status: 404 });
}

if (process.argv.includes("--check")) {
  const config = await loadConfig();
  const prompts = await listPrompts().catch(() => []);
  await mkdir(CONVERSATIONS_DIR, { recursive: true });
  console.log(JSON.stringify({
    ok: true,
    port: PORT,
    root: ROOT_DIR,
    provider: config.provider,
    promptCount: prompts.length,
  }));
  process.exit(0);
}

await mkdir(CONVERSATIONS_DIR, { recursive: true });
startPromptWatcher();

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  fetch: handleRequest,
});

console.log(`AI Assistant backend listening on http://${server.hostname}:${server.port}`);
