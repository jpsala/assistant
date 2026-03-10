const GUIDE_URL = "https://md.jpsala.dev/view?guide=ai-assistant&f=DOC/README.md";

export function getGuideUrl(): string {
  const explicit = process.env.ASSISTANT_GUIDE_URL?.trim();
  if (explicit) return explicit;
  return GUIDE_URL;
}

export { GUIDE_URL };
