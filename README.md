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
| `Alt+Shift+W` | Prompt Chat — conversational workspace for iterating on selected text |
| `Alt+Shift+F` | Fix clipboard — auto-detects language, corrects text in JP's style, replaces clipboard |
| *(user-assigned)* | Prompt picker — spotlight-style list to silently run a command on selected text |
| *(user-assigned)* | Prompt Chat picker — opens Prompt Chat after the first selected prompt run |

All hotkeys are configurable in Settings (right-click tray icon).

## Prompt Chat (Alt+Shift+W)

- **Original text** pinned at the top of the session
- **Chat-style timeline**: initial prompt, first assistant reply, and all follow-up turns
- **Composer**: supports `/prompt name` on the first line to inject a saved prompt into that turn
- **Actions**: copy latest assistant reply or replace selected text in the target app
- **Shortcuts**: `Ctrl+Enter` to send, `Escape` to hide

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
  iterative.html          # Prompt Chat UI (chat-style iterative workspace)
  picker.html             # Prompt picker popup (spotlight-style, pre-loaded at startup)
  shared.css              # Shared window styles
  window-ui.js            # Shared resize/footer/textarea behavior
  ahk-bridge.js           # Shared WebView bridge helpers
lib/
  api.ahk                 # Multi-provider API calls, models fetch, settings persistence
  prompts.ahk             # Style definitions (STYLE_ES, STYLE_EN), task prompts, GetSystemPrompt()
  lang.ahk                # DetectLanguage() — Spanish chars + common word frequency
  WebViewToo.ahk          # WebView2 wrapper library (external)
  WebView2.ahk            # WebView2 COM bindings
prompts/
  *.md                     # Prompt definitions (auto-reloaded every 5s)
.env.example               # Example env with all supported providers
.env                       # Local API keys (gitignored)
```

## Prompts system

Commands live in `prompts/*.md`. The app reloads the folder every 5 seconds, so you can add, edit, or delete prompts without restarting.

Each prompt file uses a small header plus the prompt body:
```md
@name:Quick translate
@provider:openrouter
@model:openai/gpt-4.1-mini
@hotkey:!+t
@confirm:true

Translate this text to English. Keep the tone and meaning.
```

## Technical notes

- **UTF-8:** HTTP responses use `ADODB.Stream` to decode `ResponseBody` as UTF-8 (not `ResponseText`, which assumes ANSI and garbles Spanish chars)
- **JSON:** No external libraries — request built via string concatenation, response parsed with RegEx
- **GUI:** WebView2 (via WebViewToo library) — HTML/CSS/JS UI embedded in AHK window. Dark theme, `+AlwaysOnTop`, hides on close/escape
- **AHK↔JS communication:** JS calls AHK via `window.chrome.webview.postMessage()`, AHK calls JS via `ExecuteScriptAsync()`

## Command metadata prefixes

You can add optional metadata at the top of each prompt file:

- `@provider:<provider-id>` to force a specific provider for that command (`openrouter`, `openai`, `anthropic`, `xai`)
- `@model:<model-id>` to force a specific model for that command
- `@hotkey:<ahk-key>` to assign a global hotkey that silently processes selected text (or clipboard) and replaces it in-place, without opening any window
- `@confirm:true` to show the review window before a hotkey prompt runs

Example:

```md
@name:Fix in OpenAI
@provider:openai
@model:gpt-4.1-mini

Improve this text.
```

```md
@name:Quick translate
@hotkey:!+t
@model:google/gemini-flash-1.5

Translate to English.
```
