const BUTTON_ROW_STYLE_ID = "framework-button-row-styles";

const BUTTON_ROW_CSS = `
.ui-button-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ui-button-row--end {
  justify-content: flex-end;
}

.ui-button-row--between {
  justify-content: space-between;
}
`;

export type ButtonRowAlign = "start" | "end" | "between";

function ensureButtonRowStyles(): void {
  if (document.getElementById(BUTTON_ROW_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = BUTTON_ROW_STYLE_ID;
  style.textContent = BUTTON_ROW_CSS;
  document.head.appendChild(style);
}

export function createButtonRow(align: ButtonRowAlign = "start"): HTMLDivElement {
  ensureButtonRowStyles();
  const row = document.createElement("div");
  row.className = `ui-button-row${align === "start" ? "" : ` ui-button-row--${align}`}`;
  return row;
}
