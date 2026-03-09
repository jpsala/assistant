/**
 * Feedback notifications — Native Windows balloon tips
 *
 * Replaces the previous BrowserWindow-based toast which had persistent bugs:
 * - Window didn't truly close (minimized/artifact left behind)
 * - Window could become empty/black
 * - Creating/destroying windows caused process instability
 *
 * Now uses PowerShell's System.Windows.Forms.NotifyIcon for reliable,
 * self-dismissing balloon notifications with zero window management.
 */

import type { ReplaceStatus } from "./replace";
import { createLogger } from "./logger";

const log = createLogger("feedback");

// ─── Native balloon notification ─────────────────────────────────────────────

/**
 * Show a native Windows balloon notification via PowerShell.
 * Fire-and-forget — the spawned process auto-cleans up after the balloon dismisses.
 */
function showBalloon(
  title: string,
  text: string,
  isError = false,
  durationMs = 3000,
): void {
  const sleepSec = Math.ceil(durationMs / 1000) + 1;
  // Escape single quotes for PowerShell string literals
  const safeTitle = title.replace(/'/g, "''");
  const safeText = text.replace(/'/g, "''");
  const iconType = isError ? "Error" : "Information";
  const tipIcon = isError ? "Error" : "Info";

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$n = New-Object System.Windows.Forms.NotifyIcon",
    `$n.Icon = [System.Drawing.SystemIcons]::${iconType}`,
    "$n.Visible = $true",
    `$n.BalloonTipTitle = '${safeTitle}'`,
    `$n.BalloonTipText = '${safeText}'`,
    `$n.BalloonTipIcon = '${tipIcon}'`,
    `$n.ShowBalloonTip(${durationMs})`,
    `Start-Sleep -Seconds ${sleepSec}`,
    "$n.Dispose()",
  ].join("; ");

  try {
    Bun.spawn(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
      { stdout: "ignore", stderr: "ignore" },
    );
    log.info("balloon.spawned", { title, text, isError });
  } catch (error) {
    log.warn("balloon.spawn_failed", { title, text, error });
  }
}

// ─── Status handler ──────────────────────────────────────────────────────────

function trimErrorMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

export function handleReplaceStatus(status: ReplaceStatus): void {
  log.info("status.received", status);

  // Skip transient states — balloon notifications have inherent latency,
  // so only show meaningful milestones.
  if (status.stage === "capturing" || status.stage === "pasting") {
    return;
  }

  if (status.stage === "processing") {
    showBalloon(
      "Assistant",
      `${status.promptName} \u00b7 ${status.model}`,
      false,
      5000,
    );
    return;
  }

  if (status.stage === "success") {
    const detail = status.model
      ? `${status.promptName} \u00b7 ${status.model}`
      : status.promptName;
    showBalloon("Text updated", detail, false, 3000);
    return;
  }

  if (status.stage === "error") {
    showBalloon(
      `Error: ${status.promptName}`,
      trimErrorMessage(status.detail),
      true,
      5000,
    );
  }
}
