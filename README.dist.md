# AI Assistant

Windows system tray app for text processing via OpenRouter, OpenAI, Anthropic, or xAI.

Current architecture:

- AHK v2 handles hotkeys, tray, clipboard automation, and WebView2 windows
- Optional Bun backend handles streaming, JSON-based provider I/O, prompt watching, and persisted Prompt Chat sessions

## Setup

1. Run `ai-assistant.exe`
2. On first run, a `.env` file will be created and opened in Notepad
3. Add at least one provider API key (`OPENROUTER_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`)
4. Save and restart the app

Optional for full desktop features:

5. Install Bun if you want the local backend features (`Prompt Chat`, `Settings`, streaming replies, prompt watching, saved conversations)
6. The packaged app includes the backend source under `backend\src\`, and starts it automatically when Bun is available

Optional for development:

7. From the source repo, run `bun install`
8. Start the backend with `bun run backend:dev`

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

When the Bun backend is running, Prompt Chat streams tokens as they arrive and saves the session under `data/conversations/`.

### Prompt picker

A quick-access floating list for running commands without opening the main window:

1. Select some text in any app
2. Press the assigned hotkey (configure in Settings)
3. Pick a command — the selected text is processed and replaced in-place

Press `Escape` to close without running anything. Focus returns to the app you were in.

## Customizing commands

Edit the `.md` files inside `prompts\` to add, remove, or modify commands.

- Without Bun: the AHK app reloads the folder every 5 seconds
- With Bun: prompt catalog updates can be pushed immediately

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
| `backend\src\index.ts` | Bundled Bun backend entrypoint used by packaged app features |
| `.env` | API keys (created on first run) |
| `.env.example` | Example env file with all supported providers |
| `prompts\*.md` | Command definitions |
| `model.conf` | Selected model (auto-created) |
| `settings.conf` | Hotkeys and settings (auto-created) |
| `data\conversations\*.json` | Prompt Chat history (auto-created when backend is used) |
| `ui/` | HTML interface files |
| `lib/` | AHK libraries and WebView2 DLLs |

## Hotkeys

Default hotkeys can be changed in Settings (right-click tray icon > Settings).

| Default | Action |
|---------|--------|
| Alt+Shift+W | Open Prompt Chat |
| Alt+Shift+F | Fix clipboard |
| *(none)* | Prompt picker (assign in Settings) |
