# AI Assistant

Windows system tray app for text processing via OpenRouter, OpenAI, Anthropic, or xAI.

Current architecture:

- AHK v2 handles hotkeys, tray, clipboard automation, and WebView2 windows
- Bundled Bun backend handles streaming, JSON-based provider I/O, prompt watching, and persisted Prompt Chat sessions

## Setup

1. Run `ai-assistant.exe`
2. On first run, the app opens a setup window
3. Choose a provider, paste an API key, validate it, and continue
4. The packaged app stores your writable data under `%LocalAppData%\AI Assistant`

Optional for development:

5. From the source repo, run `bun install`
6. Start the backend with `bun run backend:dev`

## Usage

- **Alt+Shift+W** — Open Prompt Chat
- **Alt+Shift+F** — Fix clipboard text (auto-detect language, fix grammar/spelling)
- *(user-assigned)* — **Prompt picker**: spotlight-style list to silently run a command on selected text
- Right-click the tray icon for Settings, Prompt Editor, and more

### Prompt Chat

1. Press `Alt+Shift+W` with text selected to capture the selection into the session
2. Write the next instruction in the composer
3. Use `/prompt name` on the first line to expand a saved prompt into that turn
4. Press `Enter` to send or `Shift+Enter` for a newline
5. Copy the latest assistant reply or replace the original selection in-place

When the backend is running, Prompt Chat streams tokens as they arrive and saves the session under your local profile data directory.

### Prompt picker

A quick-access floating list for running commands without opening the main window:

1. Select some text in any app
2. Press the assigned hotkey (configure in Settings)
3. Pick a command — the selected text is processed and replaced in-place

Press `Escape` to close without running anything. Focus returns to the app you were in.

## Customizing commands

Edit the `.md` files inside your runtime `prompts\` folder to add, remove, or modify commands.

- In the packaged app, prompts are copied into `%LocalAppData%\AI Assistant\prompts`
- Prompt catalog updates can be pushed immediately through the bundled backend

### Format

```md
@name:Command name

Your prompt instruction here.
Line 2
Line 3
```

### Special prefixes

- **`@provider:`** — Override the default provider for a command (`openrouter`, `openai`, `anthropic`, `xai`)

- **`@model:`** — Override the default model for a specific command

- **`@hotkey:`** — Assign a global hotkey to run this command silently on selected text (AHK key syntax)
  Commands with `@hotkey:` also appear in the prompt picker with their hotkey shown.

- **`@confirm:true`** — Ask for confirmation before running the prompt from a hotkey

Example:
```md
@name:My command
@provider:openrouter
@model:anthropic/claude-sonnet-4.6
@hotkey:!+1
@confirm:true

Your prompt here.
```

## Files

| File | Description |
|------|-------------|
| `ai-assistant.exe` | Main application |
| `backend\src\index.ts` | Bundled backend entrypoint |
| `.env.dist` | Example env template bundled with the app |
| `%LocalAppData%\AI Assistant\prompts\*.md` | Editable command definitions |
| `%LocalAppData%\AI Assistant\model.conf` | Selected model |
| `%LocalAppData%\AI Assistant\settings.conf` | Hotkeys and settings |
| `%LocalAppData%\AI Assistant\data\conversations\*.json` | Prompt Chat history |
| `ui/` | HTML interface files |
| `lib/` | AHK libraries and WebView2 DLLs |

## Hotkeys

Default hotkeys can be changed in Settings (right-click tray icon > Settings).

| Default | Action |
|---------|--------|
| Alt+Shift+W | Open Prompt Chat |
| Alt+Shift+F | Fix clipboard |
| *(none)* | Prompt picker (assign in Settings) |
