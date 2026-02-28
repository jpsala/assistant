# Changelog

All notable changes to AI Assistant are documented in this file.

## [Unreleased]

### Added
- `@confirm` directive for hotkey prompts: shows a pre-run dialog letting you review and edit both the prompt text and the input text before the API call is made. Add `@confirm:true` in `prompts.json` or toggle the new checkbox in the Prompt Editor.
- "Manual" built-in prompt (hotkey `Alt+T,T`) as an empty `@confirm` prompt for ad-hoc one-off requests without opening the main window.
- Prompt Editor: "Confirm prompt before running by hotkey" checkbox; saved/loaded from `prompts.json` and shown as a "Confirm" tag in the prompt list.

### Changed
- `Como yo (español)` and `Like me (English)` prompts moved to `@file:`-free inline format with `@provider:openrouter` and hotkeys assigned.
- Added hotkeys to `Traducir a inglés` (`Alt+T,E`), `Traducir a español` (`Alt+T,S`), and `Como yo` (`Alt+T,Y`) / `Like me` (`Alt+T,L`).
- Prompt Editor "save" no longer rejects empty prompt text (allows `@confirm` prompts with no default body).
- Opening or saving a prompt in the Prompt Editor defensively calls `ResumeDynamicHotkeys` / `ResumePromptHotkeys` to recover any suspended hotkeys.

### Added
- Resizable windows: WM_NCHITTEST handler creates virtual 6px grab borders on all three resizable windows (main, settings, prompt editor), restoring drag-to-resize after `-Caption` removed native OS borders
- Main window and Prompt Editor now persist their size to `settings.conf` (`main_w/h`, `editor_w/h`) and restore on next open
- Tray menu items now show system icons (shell32/imageres DLLs), with silent fallback if an index is unavailable
- Settings: "General" section with Windows autostart toggle and max tokens input
- Settings: eye button on each API key field to reveal/hide the value
- Settings: max tokens saved immediately on field commit

### Changed
- Settings window visual overhaul: card-style sections, CSS toggle switch, compact scrollbar, better typography and focus rings

### Fixed
- Command input label now shows the actual configured hotkey instead of the hardcoded "(Alt+J)"; updates live when changed in Settings
- Settings close handler now saves size on both JS-close and Alt+F4 paths
- Settings size written atomically (single file write via SaveSettingBatch)
- Main window and Prompt Editor Close handlers explicitly return 1 to prevent any default action
- Settings AHK Close handler (SaveSettingsSize) returns 1 to prevent redundant default hide

### Added
- All windows (main, picker, settings, prompt editor) now open on the monitor containing the active window, centered horizontally and at 1/3 from the top
- Prompt Picker: configurable hotkey (in Settings) that opens a filterable spotlight-style popup with all prompts; selecting one silently processes selected text or clipboard and replaces/pastes the result.
- Per-prompt hotkeys: assign a hotkey to any command in the Prompt Editor; pressing it silently processes selected text (or clipboard content) and replaces/pastes the result without opening any window. Feedback via tooltip. Original clipboard is restored after the operation.
- Clear (X) button on all editable panels (Clipboard, Prompt) — appears when text is present
- Pre-load WebView2 in background at startup for instant first open
- Build script (`build.bat`) — compiles to exe and creates dist/ folder with all runtime files

### Fixed
- Prompt editor hotkey field showing garbled value (e.g. "Alt+Shift+c\n@model:...") due to malformed escape sequences in prompts.json
- `EscJsonFile` writing standard JSON `\n` (2 chars) instead of `\\n` (3 chars) required by `LoadPrompts`, causing directive parsing failures after any save from the editor

## [0.5.0] - 2025-02-18

### Added
- Configurable hotkeys in Settings (Main window, Reload)
- Startup beep as audible feedback on reload

### Fixed
- Hotkey assignment bug: pass data in postMessage instead of JS globals
- UTF-8 BOM in settings.conf breaking settings parsing

## [0.4.0] - 2025-02-17

### Added
- Visible window borders (1px white, CSS-based)
- Draggable windows via `-webkit-app-region: drag` (no title bars)
- Grip dot pattern (3x2 grid) on drag handles
- Settings organized into sections (Default Model, Hotkeys)
- `max_tokens` setting with persistence via `settings.conf`

### Fixed
- Grip dots subpixel color fringe in Chromium (use squares with 1px radius)

## [0.3.0] - 2025-02-16

### Added
- Prompt Editor window for managing prompts and per-command models
- Filterable model picker in Prompt Editor
- Per-command model override via `@model:` prefix in prompts.json
- Resizable panels with splitter persistence
- Editable clipboard preview in main window
- Command dropdown opens upward (picker at bottom)
- como-yo/like-me style prompts

## [0.2.0] - 2025-02-15

### Added
- Settings window accessible from tray menu and main UI
- Model selection with searchable dropdown (fetches from OpenRouter API)
- Current model displayed in main window status bar
- Model persistence via `model.conf`

### Fixed
- JS-to-AHK communication: switched from `AddCallbackToScript` to `postMessage`
- WebView2 message handling: use `add_WebMessageReceived` directly
- Deadlock fix: defer all WebView calls outside message handler callbacks

## [0.1.0] - 2025-02-14

### Added
- Initial release: AHK v2 system tray app for daily text processing
- WebView2 GUI via WebViewToo (replaced Win32 GUI)
- Fix clipboard function (Alt+Shift+F): auto-detect language, fix text via OpenRouter API
- Main window (Alt+Shift+W): prompt-based text processing with clipboard input
- Command system: load prompts from `prompts.json` with `@file:` support
- Auto-reload prompts on file change (5s polling)
- OpenRouter API integration with configurable model
