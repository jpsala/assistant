# AI Assistant

Hybrid Windows desktop assistant for daily text processing.

- **Shell/runtime:** AutoHotkey v2 system tray app with global hotkeys, clipboard automation, and WebView2 windows
- **Backend:** optional Bun sidecar for provider I/O, streaming SSE, prompt watching, and conversation persistence
- **Providers:** OpenRouter, OpenAI, Anthropic, xAI

## Setup

- **Runs on:** Windows 11 (AHK v2, not WSL)
- **API keys:** `.env` (gitignored) and/or Settings window
- **Template:** copy `.env.example` to `.env` and fill keys
- **Optional dev tooling:** `bun install`

## Hotkeys

| Hotkey | Action |
|--------|--------|
| `Alt+Shift+W` | Prompt Chat — conversational workspace for iterating on selected text |
| `Alt+Shift+F` | Fix clipboard — auto-detects language, corrects text in JP's style, replaces clipboard |
| *(user-assigned)* | Prompt picker — spotlight-style list to silently run a command on selected text |
| *(user-assigned)* | Prompt Chat picker — opens Prompt Chat after the first selected prompt run |

All hotkeys are configurable in Settings (right-click tray icon).

## Prompt Chat (Alt+Shift+W)

- **Can capture selected text directly** when opened from the hotkey
- **Original text** pinned at the top of the session
- **Chat-style timeline**: initial prompt, first assistant reply, and all follow-up turns
- **Composer**: supports `/prompt name` on the first line to inject a saved prompt into that turn
- **Streaming replies**: when the Bun backend is running, assistant tokens appear as they arrive
- **Persistence**: sessions are saved to `data/conversations/*.json` through the backend
- **History panel**: recent persisted sessions can be reopened directly from Prompt Chat
- **Actions**: copy latest assistant reply or replace selected text in the target app
- **Shortcuts**: `Enter` to send, `Shift+Enter` for newline, `Ctrl+Enter` also sends, `Escape` hides

## Prompt picker

A spotlight-style floating window for running commands silently on selected text without opening the main window.

- Assign a hotkey in Settings — it appears as a configurable hotkey
- Press the hotkey → picker appears, focused and ready to type
- Type to filter, `↑↓` to navigate, `Enter` to run, `Escape` to cancel
- On select: picker hides, focus returns to the previous app, selected text is processed and replaced in-place
- Each item shows the command name, its assigned hotkey (if any), and its model override (if any)

## File structure

```
ai-assistant.ahk          # Main shell: tray, hotkeys, WebView GUI, prompt loading, Windows automation
backend/
  src/index.ts            # Bun backend: provider I/O, SSE streaming, prompt watching, persistence
ui/
  iterative.html          # Prompt Chat UI (streams through Bun when available)
  picker.html             # Prompt picker popup (spotlight-style, pre-loaded at startup)
  shared.css              # Shared window styles
  window-ui.js            # Shared resize/footer/textarea behavior
  ahk-bridge.js           # Shared WebView bridge helpers
lib/
  api.ahk                 # Multi-provider API calls, Bun backend bridge, settings persistence
  prompts.ahk             # Style definitions (STYLE_ES, STYLE_EN), task prompts, GetSystemPrompt()
  lang.ahk                # DetectLanguage() — Spanish chars + common word frequency
  WebViewToo.ahk          # WebView2 wrapper library (external)
  WebView2.ahk            # WebView2 COM bindings
prompts/
  *.md                    # Prompt definitions
data/
  conversations/*.json    # Prompt Chat session persistence (created by Bun backend)
.env.example               # Example env with all supported providers
.env                       # Local API keys (gitignored)
package.json               # Bun scripts + dev dependencies
```

## Prompts system

Commands live in `prompts/*.md`.

- **AHK fallback mode:** prompts reload every 5 seconds via polling
- **Bun-backed mode:** prompt catalog updates can arrive instantly through `fs.watch()` + SSE

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

- **WebView layer:** still WebView2/Chromium via AHK, not Electron/Electrobun
- **UTF-8:** AHK fallback still uses `ADODB.Stream`; Bun uses native UTF-8 strings
- **JSON:** AHK fallback still uses string concatenation/RegEx; Bun backend uses normal JSON parsing/serialization
- **GUI:** WebView2 (via WebViewToo library) — HTML/CSS/JS UI embedded in AHK window. Dark theme, `+AlwaysOnTop`, hides on close/escape
- **AHK↔JS communication:** existing WebView bridge still exists for window controls, clipboard actions, and fallback request paths
- **Backend transport:** local HTTP on `http://127.0.0.1:8765` with JSON + SSE
- **Fallback behavior:** if Bun is not installed or the backend is unavailable, the app still works through the older direct AHK provider path

## Hybrid Bun backend

The Bun sidecar is optional, but the app now prefers it automatically when `bun` is available on `PATH`.

What it does now:

- **Provider I/O in TypeScript**
- **Streaming Prompt Chat via SSE**
- **Model listing**
- **Prompt catalog API**
- **Prompt watch SSE**
- **Conversation persistence**
- **Safe AHK fallback**

## Development

Install backend tooling:

```bash
bun install
```

Run the backend manually during development:

```bash
bun run backend:dev
```

Quick backend self-check:

```bash
bun run backend:check
```

Typecheck the backend:

```bash
node_modules/.bin/tsc --noEmit
```

Run the backend smoke test:

```bash
bun run backend:smoke
```

## What Is Better Now

- **Prompt Chat no longer has to wait for a full response before updating the UI** when the backend is active
- **Provider/model fetching is more robust** because the Bun backend uses real JSON handling instead of regex extraction
- **Settings state is more centralized** because provider selection, model selection, and API key persistence now flow through the backend
- **Settings UI is less coupled to AHK** because provider/model/API key flows now call Bun directly from the WebView
- **Hotkey settings are more centralized** because the Settings UI now persists them through backend endpoints before AHK reloads registrations
- **Prompt Editor is less coupled to AHK** because prompt CRUD and model loading now call Bun directly from the WebView
- **Prompt Editor updates are more live** because it now listens to prompt watch events from Bun
- **Prompt Chat sessions can persist across launches** through `data/conversations`
- **Saved Prompt Chat sessions are now actually navigable from the UI** through the history panel
- **Prompt updates can be pushed immediately** from the Bun backend instead of waiting for the 5-second AHK polling loop
- **The app is easier to extend** because the risky parts are now split: AHK handles Windows automation, Bun handles network/state work

## What Is Different Now

- The project is no longer AHK-only
- The app still uses WebView2 for desktop UI
- A local Bun backend can start automatically when AHK needs it
- `lib/api.ahk` is now both a provider client and a backend bridge
- Settings provider/model/API key changes now persist through backend endpoints
- Settings hotkey changes now persist through backend endpoints and then trigger AHK reload
- `ui/settings.html` now talks directly to backend endpoints for provider/model/API key state
- `ui/prompt-editor.html` now talks directly to backend endpoints for prompt CRUD and model loading
- The repo has a small TypeScript toolchain (`package.json`, `tsconfig.json`, `bun.lock`)

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
