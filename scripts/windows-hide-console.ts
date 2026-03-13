import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3;
const PE_POINTER_OFFSET = 0x3c;
const PE_SIGNATURE = 0x00004550;
const OPTIONAL_HEADER_OFFSET = 24;
const SUBSYSTEM_OFFSET = 68;

function getLauncherPath(): string | null {
  if (process.platform !== "win32") return null;
  if (process.env.ELECTROBUN_OS !== "win") return null;

  const buildDir = process.env.ELECTROBUN_BUILD_DIR;
  const appName = process.env.ELECTROBUN_APP_NAME;
  if (!buildDir || !appName) return null;

  const launcherPath = join(buildDir, appName, "bin", "launcher.exe");
  return existsSync(launcherPath) ? launcherPath : null;
}

function patchWindowsSubsystem(filePath: string): "patched" | "already-gui" {
  const buffer = readFileSync(filePath);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  if (buffer.length < PE_POINTER_OFFSET + 4 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
    throw new Error(`Invalid DOS header in ${filePath}`);
  }

  const peOffset = view.getUint32(PE_POINTER_OFFSET, true);
  if (peOffset + OPTIONAL_HEADER_OFFSET + SUBSYSTEM_OFFSET + 2 > buffer.length) {
    throw new Error(`Invalid PE header offset in ${filePath}`);
  }

  if (view.getUint32(peOffset, true) !== PE_SIGNATURE) {
    throw new Error(`Invalid PE signature in ${filePath}`);
  }

  const subsystemOffset = peOffset + OPTIONAL_HEADER_OFFSET + SUBSYSTEM_OFFSET;
  const subsystem = view.getUint16(subsystemOffset, true);

  if (subsystem === IMAGE_SUBSYSTEM_WINDOWS_GUI) {
    return "already-gui";
  }

  if (subsystem !== IMAGE_SUBSYSTEM_WINDOWS_CUI) {
    throw new Error(`Unexpected subsystem value ${subsystem} in ${filePath}`);
  }

  view.setUint16(subsystemOffset, IMAGE_SUBSYSTEM_WINDOWS_GUI, true);
  writeFileSync(filePath, buffer);
  return "patched";
}

const launcherPath = getLauncherPath();

if (!launcherPath) {
  console.log("[postBuild] Windows launcher not found or current target is not Windows; skipping.");
  process.exit(0);
}

const result = patchWindowsSubsystem(launcherPath);
console.log(`[postBuild] ${result} ${launcherPath}`);
