/**
 * Multi-provider LLM client with streaming.
 *
 * Providers: openrouter | openai | anthropic | xai
 * All use fetch() + SSE for streaming.
 * Anthropic uses a different request/response format; the rest are OpenAI-compatible.
 */

import type { Provider } from "./prompts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type StreamCallbacks = {
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
};

export type LLMRequest = {
  provider: Provider;
  model: string;
  apiKey: string;
  messages: Message[];
  systemPrompt?: string;
  maxTokens?: number;
};

// ─── Provider config ──────────────────────────────────────────────────────────

type ProviderConfig = {
  baseUrl: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
};

export const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4-5",
    extraHeaders: {
      "HTTP-Referer": "https://assistant.local",
      "X-Title": "Assistant",
    },
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-5-20251022",
    extraHeaders: {
      "anthropic-version": "2023-06-01",
    },
  },
  xai: {
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-mini",
  },
};

// ─── OpenAI-compatible streaming (openrouter, openai, xai) ───────────────────

async function streamOpenAI(req: LLMRequest, cbs: StreamCallbacks): Promise<void> {
  const config = PROVIDER_CONFIGS[req.provider];

  const messages: Message[] = req.systemPrompt
    ? [{ role: "system", content: req.systemPrompt }, ...req.messages]
    : req.messages;

  const body = {
    model: req.model,
    messages,
    max_tokens: req.maxTokens ?? 8192,
    stream: true,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${req.apiKey}`,
    ...config.extraHeaders,
  };

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${req.provider} API error ${res.status}: ${text}`);
  }

  let fullText = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const token: string =
            json.choices?.[0]?.delta?.content ?? "";
          if (token) {
            fullText += token;
            cbs.onToken(token);
          }
        } catch {
          // malformed chunk — skip
        }
      }
    }

    cbs.onDone(fullText);
  } finally {
    reader.releaseLock();
  }
}

// ─── Anthropic streaming ──────────────────────────────────────────────────────

async function streamAnthropic(req: LLMRequest, cbs: StreamCallbacks): Promise<void> {
  const config = PROVIDER_CONFIGS.anthropic;

  // Anthropic doesn't allow system role in messages array
  const userMessages = req.messages.filter((m) => m.role !== "system");
  const system =
    req.systemPrompt ??
    req.messages.find((m) => m.role === "system")?.content;

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 8192,
    messages: userMessages,
    stream: true,
  };
  if (system) body.system = system;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": req.apiKey,
    ...config.extraHeaders,
  };

  const res = await fetch(`${config.baseUrl}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`anthropic API error ${res.status}: ${text}`);
  }

  let fullText = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();

        try {
          const json = JSON.parse(data);
          if (json.type === "content_block_delta") {
            const token: string = json.delta?.text ?? "";
            if (token) {
              fullText += token;
              cbs.onToken(token);
            }
          }
        } catch {
          // skip
        }
      }
    }

    cbs.onDone(fullText);
  } finally {
    reader.releaseLock();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Stream a completion. Calls onToken for each token, onDone when complete.
 * Returns a promise that resolves when streaming is done.
 */
export async function streamCompletion(
  req: LLMRequest,
  cbs: StreamCallbacks
): Promise<void> {
  try {
    if (req.provider === "anthropic") {
      await streamAnthropic(req, cbs);
    } else {
      await streamOpenAI(req, cbs);
    }
  } catch (err) {
    cbs.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Non-streaming version — returns full text (for silent replace flow).
 */
export async function complete(req: LLMRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    streamCompletion(req, {
      onToken: () => {},
      onDone: resolve,
      onError: reject,
    });
  });
}

/** Fetch available models for a provider */
export async function fetchModels(
  provider: Provider,
  apiKey: string
): Promise<string[]> {
  const config = PROVIDER_CONFIGS[provider];

  if (provider === "anthropic") {
    // Anthropic doesn't have a public /models list endpoint — return curated list
    return [
      "claude-opus-4-5",
      "claude-sonnet-4-5-20251022",
      "claude-haiku-4-5-20251001",
    ];
  }

  const headers: Record<string, string> =
    provider === "anthropic"
      ? { "x-api-key": apiKey, ...config.extraHeaders }
      : { Authorization: `Bearer ${apiKey}`, ...config.extraHeaders };

  const res = await fetch(`${config.baseUrl}/models`, { headers });
  if (!res.ok) throw new Error(`fetchModels ${res.status}`);

  const json = await res.json() as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id).sort();
}
