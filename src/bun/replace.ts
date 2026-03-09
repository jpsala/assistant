/**
 * Silent replace flow:
 *   1. Capture selected text via Ctrl+C (FFI)
 *   2. Call LLM with the prompt
 *   3. Paste result in-place via Ctrl+V (FFI)
 *   4. Show undo toast (keeps original in memory for 30s)
 *
 * Also exports showConfirmDialog() for @confirm:true prompts.
 */

import { captureSelectedText, pasteText } from "./ffi";
import { complete } from "./llm";
import { getSettings } from "./settings";
import type { Prompt } from "./prompts";
import { createLogger } from "./logger";

const log = createLogger("replace");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReplaceResult = {
  original: string;
  result: string;
  hwnd: unknown;
  savedClipboard: string | null;
};

export type ReplaceStatus = {
  stage: "capturing" | "processing" | "pasting" | "success" | "error";
  promptName: string;
  provider: string;
  model: string;
  detail: string;
  hwnd: unknown;
};

// Callback to show the undo toast in the UI layer
type ToastFn = (result: ReplaceResult) => void;

let _toastFn: ToastFn = () => {};

export function setToastCallback(fn: ToastFn): void {
  _toastFn = fn;
}

// ─── Core flow ────────────────────────────────────────────────────────────────

/**
 * Execute a silent replace:
 *  - If prompt.confirm is true, caller should show confirm dialog first
 *    and pass the (possibly edited) promptBody and inputText directly.
 *  - Otherwise captures from selection automatically.
 */
export async function silentReplace(
  prompt: Prompt,
  options: {
    promptBody?: string; // override prompt body (from confirm dialog)
    inputText?: string;  // override captured text (from confirm dialog)
    hwnd?: unknown;      // target window (e.g. pre-captured before picker opened)
    onStatus?: (status: ReplaceStatus) => void;
  } = {}
): Promise<ReplaceResult | null> {
  const settings = getSettings();
  const provider = prompt.provider ?? settings.provider;
  const model = prompt.model ?? settings.model;
  const notify = (stage: ReplaceStatus["stage"], detail: string) => {
    log.info("status", {
      stage,
      promptName: prompt.name,
      provider,
      model,
      detail,
      hwnd: options.hwnd ?? null,
    });
    options.onStatus?.({
      stage,
      promptName: prompt.name,
      provider,
      model,
      detail,
      hwnd: options.hwnd ?? null,
    });
  };

  // 1. Capture selected text (or use provided)
  let captureResult: { text: string; hwnd: unknown; savedClipboard: string | null };

  if (options.inputText !== undefined) {
    // Came from confirm dialog — we already have text
    captureResult = {
      text: options.inputText,
      hwnd: null,
      savedClipboard: null,
    };
  } else {
    notify("capturing", "Capturing selected text");
    captureResult = await captureSelectedText(options.hwnd);
  }

  const updateHwnd = (stage: ReplaceStatus["stage"], detail: string) => {
    options.onStatus?.({
      stage,
      promptName: prompt.name,
      provider,
      model,
      detail,
      hwnd: captureResult.hwnd,
    });
  };

  const inputText = captureResult.text.trim();
  if (!inputText) {
    log.warn("capture.empty", { promptName: prompt.name });
    updateHwnd("error", "No text is selected");
    return null;
  }

  const promptBody = options.promptBody ?? prompt.body;
  const apiKey = settings.apiKeys[provider];

  if (!apiKey) {
    log.error("provider.api_key_missing", { promptName: prompt.name, provider });
    updateHwnd("error", `Missing API key for ${provider}`);
    return null;
  }

  // 2. Call LLM (non-streaming for silent replace — paste when complete)
  let result: string;
  try {
    updateHwnd("processing", "Running prompt");
    result = await complete({
      provider,
      model,
      apiKey,
      messages: [{ role: "user", content: inputText }],
      systemPrompt: promptBody,
      maxTokens: settings.maxTokens,
    });
  } catch (err) {
    log.error("llm.failed", { promptName: prompt.name, provider, model, error: err });
    updateHwnd(
      "error",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  result = result.trim();
  if (!result) {
    log.warn("llm.empty_response", { promptName: prompt.name, provider, model });
    updateHwnd("error", "The model returned an empty response");
    return null;
  }

  // 3. Paste result in-place
  updateHwnd("pasting", "Applying generated text");
  await pasteText(result, captureResult.hwnd, captureResult.savedClipboard);

  const replaceResult: ReplaceResult = {
    original: inputText,
    result,
    hwnd: captureResult.hwnd,
    savedClipboard: captureResult.savedClipboard,
  };

  // 4. Show undo toast
  _toastFn(replaceResult);
  updateHwnd("success", "Text updated");
  log.info("completed", {
    promptName: prompt.name,
    provider,
    model,
    inputChars: inputText.length,
    outputChars: result.length,
  });

  return replaceResult;
}

/**
 * Undo the last replace — pastes the original text back.
 */
export async function undoReplace(r: ReplaceResult): Promise<void> {
  await pasteText(r.original, r.hwnd, r.savedClipboard);
}
