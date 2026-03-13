const BUTTON_STYLE_ID = "framework-button-styles";

const BUTTON_CSS = `
.ui-button {
  min-width: 88px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--ws-border);
  background: transparent;
  color: var(--ws-text);
  font: 11px/1 "Segoe UI", system-ui, sans-serif;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ui-button__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-button__shortcut {
  font: 10px/1 Consolas, "Fira Mono", monospace;
  color: var(--ws-text-muted);
  padding: 2px 5px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--ws-border-strong) 72%, transparent 28%);
  background: color-mix(in srgb, var(--ws-bg-muted) 82%, transparent 18%);
}

.ui-button:hover {
  background: var(--ws-bg-muted);
  border-color: var(--ws-border-strong);
}

.ui-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.ui-button--primary {
  background: var(--ws-accent);
  border-color: var(--ws-accent);
  color: white;
}

.ui-button--primary .ui-button__shortcut {
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.14);
}

.ui-button--primary:hover {
  filter: brightness(1.06);
}

.ui-button--secondary {
  background: color-mix(in srgb, var(--ws-bg-elevated) 82%, var(--ws-bg) 18%);
}

.ui-button--ghost {
  border-color: transparent;
  color: var(--ws-text-muted);
}

.ui-button--ghost:hover {
  border-color: var(--ws-border);
  color: var(--ws-text);
}

.ui-button--danger {
  border-color: rgba(196, 43, 28, 0.5);
  color: #ffb4ab;
}

.ui-button--danger:hover {
  background: rgba(196, 43, 28, 0.14);
  border-color: rgba(196, 43, 28, 0.8);
  color: #ffd2cc;
}
`;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonOptions = {
  id?: string;
  label: string;
  shortcut?: string;
  variant?: ButtonVariant;
  title?: string;
  disabled?: boolean;
};

function ensureButtonStyles(): void {
  if (document.getElementById(BUTTON_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = BUTTON_STYLE_ID;
  style.textContent = BUTTON_CSS;
  document.head.appendChild(style);
}

export function createButton(options: ButtonOptions): HTMLButtonElement {
  ensureButtonStyles();
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ui-button ui-button--${options.variant ?? "secondary"}`;
  const label = document.createElement("span");
  label.className = "ui-button__label";
  label.textContent = options.label;
  button.appendChild(label);
  if (options.shortcut) {
    const shortcut = document.createElement("span");
    shortcut.className = "ui-button__shortcut";
    shortcut.textContent = options.shortcut;
    button.appendChild(shortcut);
  }
  if (options.id) button.id = options.id;
  if (options.title) button.title = options.title;
  if (options.disabled) button.disabled = true;
  return button;
}
