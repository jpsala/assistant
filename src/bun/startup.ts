import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { createLogger } from "./logger";
import type { Settings } from "./settings";

const log = createLogger("startup-launch");

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME = "Assistant";

function isWindows(): boolean {
  return process.platform === "win32";
}

function getLauncherPath(): string | null {
  if (!isWindows()) return null;

  const runtimeDir = dirname(process.execPath);
  const candidates = [
    join(runtimeDir, "launcher.exe"),
    join(runtimeDir, "launcher"),
  ];

  for (const launcherPath of candidates) {
    if (existsSync(launcherPath)) {
      return launcherPath;
    }
  }

  return null;
}

function runReg(args: string[]): { success: boolean; stdout: string; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: ["reg.exe", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    success: proc.exitCode === 0,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

export function supportsLaunchAtStartup(): boolean {
  return Boolean(getLauncherPath());
}

export function setLaunchAtStartup(enabled: boolean): boolean {
  if (!isWindows()) return false;

  if (!enabled) {
    const result = runReg(["delete", RUN_KEY, "/v", VALUE_NAME, "/f"]);
    if (!result.success && !/unable to find/i.test(result.stderr + result.stdout)) {
      log.warn("disable.failed", { stderr: result.stderr, stdout: result.stdout });
      return false;
    }
    log.info("disabled");
    return true;
  }

  const launcherPath = getLauncherPath();
  if (!launcherPath) {
    log.warn("enable.skipped_launcher_missing", { execPath: process.execPath });
    return false;
  }

  const command = `"${launcherPath}"`;
  const result = runReg(["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", command, "/f"]);
  if (!result.success) {
    log.warn("enable.failed", { stderr: result.stderr, stdout: result.stdout, launcherPath });
    return false;
  }

  log.info("enabled", { launcherPath });
  return true;
}

export function syncLaunchAtStartup(settings: Settings): void {
  if (!isWindows()) return;

  const ok = setLaunchAtStartup(settings.startWithSystem);
  log.info("sync.completed", {
    enabled: settings.startWithSystem,
    ok,
    supported: supportsLaunchAtStartup(),
  });
}
