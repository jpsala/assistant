# AI Assistant

AHK v2 system tray app for daily text processing. Lives in memory, called via global hotkeys, and can run through multiple providers (OpenRouter, OpenAI, Anthropic, xAI).

## Setup

- **Runs on:** Windows 11 (AHK v2, not WSL)
- **Dev path:** `/home/jp/dev/ai-assistant/` → symlink to `/mnt/c/tools/ai-assistant/`
- **Providers:** OpenRouter, OpenAI, Anthropic, xAI
- **API keys:** `.env` (gitignored) and/or Settings window
- **Template:** copy `.env.example` to `.env` and fill keys

## Hotkeys

| Hotkey | Action |
|--------|--------|
| `Alt+Shift+W` | Main window — prompt-based: shows clipboard preview, command picker, prompt field, result |
| `Alt+Shift+F` | Fix clipboard — auto-detects language, corrects text in JP's style, replaces clipboard |
| *(user-assigned)* | Prompt picker — spotlight-style list to silently run a command on selected text |

All hotkeys are configurable in Settings (right-click tray icon).

## Main window (Alt+Shift+W)

- **Clipboard preview** (read-only): shows what's in clipboard when window opens
- **Command dropdown** (`Alt+J` to focus): predefined prompts, type to filter. Shows model and hotkey per command.
- **Prompt field**: custom instructions to apply to the clipboard text
- **Result panel**: output from the API
- **Shortcuts**: `Ctrl+Enter` to submit, `Escape` to hide

## Prompt picker

A spotlight-style floating window for running commands silently on selected text without opening the main window.

- Assign a hotkey in Settings — it appears as a configurable hotkey
- Press the hotkey → picker appears, focused and ready to type
- Type to filter, `↑↓` to navigate, `Enter` to run, `Escape` to cancel
- On select: picker hides, focus returns to the previous app, selected text is processed and replaced in-place
- Each item shows the command name, its assigned hotkey (if any), and its model override (if any)

## File structure

```
ai-assistant.ahk          # Main: tray, hotkeys, WebView GUI, provider/key loading, prompt loading
ui/
  index.html              # WebView2 UI (HTML/CSS/JS, dark theme)
  picker.html             # Prompt picker popup (spotlight-style, pre-loaded at startup)
lib/
  api.ahk                 # Multi-provider API calls, models fetch, settings persistence
  prompts.ahk             # Style definitions (STYLE_ES, STYLE_EN), task prompts, GetSystemPrompt()
  lang.ahk                # DetectLanguage() — Spanish chars + common word frequency
  WebViewToo.ahk          # WebView2 wrapper library (external)
  WebView2.ahk            # WebView2 COM bindings
prompts.json               # Command definitions (auto-reloaded every 5s)
prompts/
  como-yo.md               # Full Spanish writing style prompt (@file: reference)
  like-me.md               # Full English writing style prompt (@file: reference)
.env.example               # Example env with all supported providers
.env                       # Local API keys (gitignored)
```

## Prompts system

Commands live in `prompts.json` as `"Name": "prompt text"` pairs. The app reloads this file every 5 seconds — no restart needed to add/edit commands.

For long prompts, use `@file:` references:
```json
"Como yo (español)": "@file:prompts/como-yo.md"
```

## Technical notes

- **UTF-8:** HTTP responses use `ADODB.Stream` to decode `ResponseBody` as UTF-8 (not `ResponseText`, which assumes ANSI and garbles Spanish chars)
- **JSON:** No external libraries — request built via string concatenation, response parsed with RegEx
- **GUI:** WebView2 (via WebViewToo library) — HTML/CSS/JS UI embedded in AHK window. Dark theme, `+AlwaysOnTop`, hides on close/escape
- **AHK↔JS communication:** JS calls AHK via `window.chrome.webview.postMessage()`, AHK calls JS via `ExecuteScriptAsync()`

## Command metadata prefixes

You can add optional metadata at the top of each command value in `prompts.json`:

- `@provider:<provider-id>` to force a specific provider for that command (`openrouter`, `openai`, `anthropic`, `xai`)
- `@model:<model-id>` to force a specific model for that command
- `@hotkey:<ahk-key>` to assign a global hotkey that silently processes selected text (or clipboard) and replaces it in-place, without opening any window
- `@file:<relative-path>` to load prompt text from a file

Example:

```json
"Fix in OpenAI": "@provider:openai\n@model:gpt-4.1-mini\nImprove this text.",
"Quick translate": "@hotkey:!+t\n@model:google/gemini-flash-1.5\nTranslate to English."
```
