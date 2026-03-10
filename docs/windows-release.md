# Windows Release

This project uses two layers for Windows distribution:

1. Electrobun creates the stable Windows artifacts
2. The packaging script extracts the real app bundle from the stable tarball into a staging folder
3. Inno Setup wraps that staged app into a normal Windows installer wizard

## Prerequisites

- Bun installed
- Project dependencies installed with `bun install`
- Inno Setup 6 installed
  - `ISCC.exe` should be available in `PATH`, or installed in one of:
    - `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`
    - `C:\Program Files\Inno Setup 6\ISCC.exe`

## One-command packaging

```powershell
bun run package:win
```

That command does two things:

1. Runs `bun run build -- --env=stable`
2. Extracts `build/stable-win-x64/Assistant-Setup.tar.zst` into `build/stable-win-x64/installer-stage`
3. Runs Inno Setup with `scripts/windows-installer.iss`

## Output

Stable Electrobun bundle:

- `build/stable-win-x64/Assistant`
- `build/stable-win-x64/Assistant-Setup.tar.zst`
- `build/stable-win-x64/installer-stage/Assistant`

Inno Setup installer:

- `artifacts/windows-installer/Assistant-Installer.exe`

Electrobun artifacts that may still be useful:

- `artifacts/stable-win-x64-Assistant-Setup.zip`
- `artifacts/stable-win-x64-Assistant.tar.zst`
- `artifacts/stable-win-x64-update.json`

## Files involved

- `electrobun.config.ts`
  - App metadata
  - Stable Windows app icon via `build.win.icon`
- `scripts/build-windows-installer.ps1`
  - Automates stable build + Inno Setup
- `scripts/windows-installer.iss`
  - Inno Setup definition

## Installer behavior

The Inno installer currently:

- installs to `%LocalAppData%\Programs\Assistant`
- creates a Start Menu shortcut
- optionally creates a Desktop shortcut
- offers `Launch Assistant` after installation
- offers `Open Quick Start Guide` after installation

The current guide URL is:

- `https://md.jpsala.dev/view?guide=ai-assistant&f=DOC/README.md`

The separate app setting `Launch on Login` is handled by the app itself after install.

## Versioning

The PowerShell packaging script reads app name and version from `electrobun.config.ts`.

Before a release:

1. Update `app.version` in `electrobun.config.ts`
2. Rebuild the stable package
3. Generate the Inno installer

## Recommended release checklist

1. `bun run package:win`
2. Install on a clean Windows machine or VM
3. Verify:
   - app launches from Start Menu
   - tray icon appears
   - hotkeys work
   - Settings persist
   - `Launch on Login` writes/removes startup entry correctly
   - uninstall removes the app cleanly
4. If shipping publicly, sign both:
   - `build/stable-win-x64/installer-stage/Assistant/bin/launcher.exe`
   - `artifacts/windows-installer/Assistant-Installer.exe`

## Notes

- Electrobun's built-in Windows packaging is usable, but it is not a polished wizard-style installer.
- Inno Setup is the preferred Windows-facing installer path for this repo.
