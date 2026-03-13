const SPINNER_STYLE_ID = "framework-spinner-styles";

const SPINNER_CSS = `
.ui-spinner {
  width: 12px;
  height: 12px;
  display: inline-block;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--ws-text-muted) 28%, transparent 72%);
  border-top-color: var(--ws-accent);
  animation: ui-spinner-rotate 0.8s linear infinite;
}

.ui-spinner--sm {
  width: 10px;
  height: 10px;
  border-width: 2px;
}

.ui-spinner--md {
  width: 12px;
  height: 12px;
  border-width: 2px;
}

.ui-spinner--lg {
  width: 16px;
  height: 16px;
  border-width: 2px;
}

@keyframes ui-spinner-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

export type SpinnerSize = "sm" | "md" | "lg";

function ensureSpinnerStyles(): void {
  if (document.getElementById(SPINNER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SPINNER_STYLE_ID;
  style.textContent = SPINNER_CSS;
  document.head.appendChild(style);
}

export function createSpinner(size: SpinnerSize = "md"): HTMLSpanElement {
  ensureSpinnerStyles();
  const spinner = document.createElement("span");
  spinner.className = `ui-spinner ui-spinner--${size}`;
  spinner.setAttribute("aria-hidden", "true");
  return spinner;
}
