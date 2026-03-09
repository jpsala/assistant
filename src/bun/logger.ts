import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";
type Meta = Record<string, unknown> | undefined;

const APPDATA = process.env.APPDATA ?? join(process.env.USERPROFILE ?? "~", "AppData", "Roaming");
const LOG_DIR = join(APPDATA, "assistant", "logs");
const LOG_PATH = join(LOG_DIR, "latest.log");

function normalize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalize(entry)]),
    );
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
}

function formatLine(level: Level, scope: string, event: string, meta?: Meta): string {
  const ts = new Date().toISOString();
  const base = `${ts} ${level.padEnd(5)} [${scope}] ${event}`;
  if (!meta || Object.keys(meta).length === 0) return `${base}\n`;
  return `${base} ${JSON.stringify(normalize(meta))}\n`;
}

function writeLine(line: string): void {
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(LOG_PATH, line, "utf8");
}

export function resetLogFile(): void {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(LOG_PATH, "", "utf8");
}

export function getLogFilePath(): string {
  return LOG_PATH;
}

export function createLogger(scope: string) {
  return {
    debug(event: string, meta?: Meta) {
      writeLine(formatLine("DEBUG", scope, event, meta));
    },
    info(event: string, meta?: Meta) {
      writeLine(formatLine("INFO", scope, event, meta));
    },
    warn(event: string, meta?: Meta) {
      writeLine(formatLine("WARN", scope, event, meta));
    },
    error(event: string, meta?: Meta) {
      writeLine(formatLine("ERROR", scope, event, meta));
    },
  };
}
