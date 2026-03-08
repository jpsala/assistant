# AI Assistant

System tray app for text processing via OpenRouter, OpenAI, Anthropic, or xAI.

## Setup

1. Run `ai-assistant.exe`
2. On first run, a `.env` file will be created and opened in Notepad
3. Add at least one provider API key (`OPENROUTER_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`)
4. Save and restart the app

## Usage

- **Alt+Shift+W** — Open the main window (prompt-based text processing)
- **Alt+Shift+F** — Fix clipboard text (auto-detect language, fix grammar/spelling)
- *(user-assigned)* — **Prompt picker**: spotlight-style list to silently run a command on selected text
- Right-click the tray icon for Settings, Prompt Editor, and more

### Main window

1. Copy text to clipboard — it appears in the Clipboard panel
2. Select a command from the dropdown, or write a custom prompt
3. Click Send (or press Ctrl+Enter)
4. Result appears below — click Copy to clipboard

The command dropdown shows the model override and hotkey for each command (if assigned).

### Prompt picker

A quick-access floating list for running commands without opening the main window:

1. Select some text in any app
2. Press the assigned hotkey (configure in Settings)
3. Pick a command — the selected text is processed and replaced in-place

Press `Escape` to close without running anything. Focus returns to the app you were in.

## Customizing commands

Edit the `.md` files inside `prompts\` to add, remove, or modify commands. The app reloads the folder automatically every 5 seconds.

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
| `.env` | API keys (created on first run) |
| `.env.example` | Example env file with all supported providers |
| `prompts\*.md` | Command definitions |
| `model.conf` | Selected model (auto-created) |
| `settings.conf` | Hotkeys and settings (auto-created) |
| `ui/` | HTML interface files |
| `lib/` | WebView2 DLLs |

## Hotkeys

Default hotkeys can be changed in Settings (right-click tray icon > Settings).

| Default | Action |
|---------|--------|
| Alt+Shift+W | Open main window |
| Alt+Shift+F | Fix clipboard |
| *(none)* | Prompt picker (assign in Settings) |
