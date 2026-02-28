# CLAUDE.md

## Project

AHK v2 system tray app for text processing via Claude/OpenRouter. Runs on Windows 11 (not WSL). Dev path: `/home/jp/dev/ai-assistant/` → symlink to `/mnt/c/tools/ai-assistant/`.

## Workflow

- **Branches**: `main` (stable) → `develop` (integration) → `feature/<name>` or `fix/<name>`.
- **One branch per feature**: create from `develop`, implement, commit, push, and open a PR to `develop`.
- **Before starting a feature**: always create the feature branch first (`git checkout -b feature/<name>`), then implement.
- **When done with a feature**: commit, push, and open a PR (`gh pr create --base develop`) — do all three steps together without waiting to be asked.
- **Changelog**: update `CHANGELOG.md` in every feature/fix commit — add a brief entry under `[Unreleased]`.
- **Commits**: concise message describing the change.
- **PRs**: open via `gh pr create --base develop`, merge via GitHub or `gh pr merge`.
- After merge, switch back to `develop` and pull.
- Merge `develop` → `main` only for stable releases.

## Code conventions

- AHK v2 syntax (not v1).
- UTF-8 everywhere.
- **WebViewToo** is the only external dependency (for WebView2 GUI). Included in `lib/`.
- JSON built via string concatenation, parsed with RegEx.
- Long prompts go in `prompts/` as `.md` files, referenced with `@file:` in `prompts.json`.

## Files

- `ai-assistant.ahk` — main entry point (tray, hotkeys, WebView GUI, .env loading).
- `ui/index.html` — WebView2 UI (HTML/CSS/JS, single file).
- `ui/picker.html` — Prompt Picker popup (filterable spotlight-style, pre-loaded at startup).
- `lib/api.ahk` — OpenRouter API calls, UTF-8 handling.
- `lib/prompts.ahk` — style definitions, task prompts, GetSystemPrompt().
- `lib/lang.ahk` — language detection.
- `lib/WebViewToo.ahk` + `lib/WebView2.ahk` + DLLs — WebView2 library.
- `prompts.json` — command definitions (hot-reloaded every 5s).
- `prompts/*.md` — long prompt files.
- `.env` — API key (gitignored, never commit).
- `model.conf` — persisted selected model.
- `settings.conf` — all other persistent settings (key=value, one per line).

Global Maps (in memory, populated at startup):
- `COMMAND_PROMPTS` — promptName → prompt text
- `COMMAND_MODELS` — promptName → model override
- `COMMAND_HOTKEYS` — promptName → AHK hotkey string (e.g. `!+1`), registered by `RegisterPromptHotkeys()`
- `PROMPT_HOTKEY_MAP` — tracks currently registered prompt hotkeys for clean unregistration

## LLM Working Guidelines

Critical patterns and pitfalls when working on this codebase.

### AHK v2 — not v1

This is AHK **v2**. The syntax is different from v1 in many ways:
- String concatenation: `.` not `+` or implicit
- Function calls always use parentheses
- No `%var%` dereferencing — use `var` directly
- `Map()` not `{}` for associative arrays; `Array` not `[]` literals in older style
- `global` declarations needed inside functions to modify globals

### WebView deadlock — the most dangerous pitfall

**Never call `ExecuteScript` (synchronous) inside a WebMessage callback.** It deadlocks.

The pattern used everywhere:
```ahk
; In the message handler — only extract the action, then defer
SetTimer(HandleAction.Bind(action), -1)

; In HandleAction (runs outside the callback) — safe to use ExecuteScript
value := wvGui.ExecuteScript("document.getElementById('x').value")
```

`ExecuteScriptAsync` is safe anywhere. Use it for fire-and-forget.
`ExecuteScript` (sync) is only safe **outside** WebMessage callbacks — use it when you need the return value.

### Four independent WebView windows

Each has its own GUI object, ready flag, and message handler:

| Window | GUI var | Ready flag | Handler |
|---|---|---|---|
| Main window | `wvGui` | `wvReady` | `WebMessageHandler` → `HandleAction` |
| Settings | `settingsGui` | `settingsReady` | `SettingsMessageHandler` → `HandleSettingsAction` |
| Prompt editor | `editorGui` | `editorReady` | `EditorMessageHandler` → `HandleEditorAction` |
| Prompt Picker | `pickerGui` | `pickerReady` | `PickerMessageHandler` → `HandlePickerAction` |

Always check `IsObject(guiVar)` before using a GUI, and the ready flag before calling `ExecuteScriptAsync`.

### Window lifecycle — hide, never destroy

Windows are **hidden** on close, not destroyed. The `OnEvent("Close", ...)` handler returns `true` to prevent destruction. This means:
- On second open, call `.Show()` on the existing object — don't re-create it.
- `IsObject(guiVar)` is the correct existence check.
- The "ready" message only fires once (on first load), not on every Show.

### JSON handling — string concatenation + RegEx

There is no JSON library. Two escape functions with different purposes:

- `EscJson(s)` — escapes for embedding in a JS string literal sent via `ExecuteScriptAsync`. Newlines become literal `\n` characters in the JS string.
- `EscJsonFile(s)` — escapes for writing to `.json` files. Newlines become the two-character sequence `\n`.

Always wrap values in `EscJson()` before embedding them in `ExecuteScriptAsync(...)` calls, e.g.:
```ahk
wvGui.ExecuteScriptAsync('setResult("' . EscJson(result) . '")')
```

### JS ↔ AHK communication

**JS → AHK:** `window.chrome.webview.postMessage({action: "actionName", ...extra fields...})`
**AHK → JS:** `guiVar.ExecuteScriptAsync("jsFunction(...)")`

The AHK handler only extracts the `action` field via RegEx, then defers. If the JS message carries extra data (like `hotkeyChanged` with `id` and `key`), extract it from the raw JSON string in `HandleSettingsAction(action, rawJson)` — don't use `ExecuteScript` to re-read it.

### Settings persistence

- `ReadSetting(key)` / `SaveSetting(key, value)` — reads/writes `settings.conf` (plain `key=value` lines).
- `SaveSelectedModel(id)` / loaded via `LoadModel()` — uses `model.conf`.
- Window sizes are saved to `settings.conf` on close (e.g. `settings_w`, `settings_h`).

### prompts.json — special directives

Values in `prompts.json` support optional prefixes parsed in a loop at load time in `LoadPrompts()` (order-independent, stripped from the front):
- `@file:filename.md` — loads prompt text from `prompts/filename.md`
- `@model:model-id\n` — sets a per-command model override
- `@hotkey:ahkKey\n` — registers a global hotkey that silently processes selected text (or clipboard) and replaces/pastes the result without showing a window

Example: `"@hotkey:!+1\n@model:google/gemini-flash-1.5\nCorregí el texto..."`

The file is hot-reloaded every 5 seconds. `SavePromptsJson()` must preserve `@file:` references and serialize `@hotkey:`/`@model:` directives back.

### UI files — no build step

`ui/*.html` are self-contained single files (inline CSS + JS, no framework, no bundler). Edit them directly. There is no `npm`, no TypeScript, no build pipeline.

### Adding a new system hotkey

Three places must be touched — missing any one causes the hotkey to not appear in Settings or not work:

1. `HOTKEY_DEFAULTS` in `lib/api.ahk` — defines that the hotkey exists and its default value (empty = unassigned)
2. `HOTKEY_ACTIONS` in `ai-assistant.ahk` — maps the action ID to a callback
3. `HOTKEY_LABELS` in `ai-assistant.ahk` — maps the action ID to the human-readable label shown in Settings

### Branch merges — watch for duplicate function definitions

If a feature branch is created from `develop` before another feature branch is merged, shared helpers (e.g. `ExecutePromptSilently`) may be defined independently in both branches. After merging, AHK will error with "This function declaration conflicts with an existing Func." — find and remove the duplicate, keeping only one definition.

### Platform

AHK runs on **Windows 11**, not WSL. File paths use backslashes (`A_ScriptDir . "\file"`). The dev path `/mnt/c/tools/ai-assistant/` is a WSL symlink to `C:\tools\ai-assistant\` — git operations work from WSL but the script itself runs on Windows.
