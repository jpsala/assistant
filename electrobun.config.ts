import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Assistant",
    identifier: "sh.blackboard.assistant",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/views/mainview/index.ts",
      },
      picker: {
        entrypoint: "src/views/picker/index.ts",
      },
      settings: {
        entrypoint: "src/views/settings/index.ts",
      },
    },
    copy: {
      "src/views/mainview/index.html": "views/mainview/index.html",
      "src/views/picker/index.html": "views/picker/index.html",
      "src/views/settings/index.html": "views/settings/index.html",
      // Starter prompts shipped with the app (seeded to %APPDATA% on first run)
      "prompts/fix-writing.md": "starter-prompts/fix-writing.md",
      "prompts/translate-english.md": "starter-prompts/translate-english.md",
      "prompts/summarize.md": "starter-prompts/summarize.md",
      "prompts/explain-code.md": "starter-prompts/explain-code.md",
      "prompts/improve-email.md": "starter-prompts/improve-email.md",
      "prompts/como-yo.md": "starter-prompts/como-yo.md",
      "prompts/corregir-texto.md": "starter-prompts/corregir-texto.md",
      "prompts/explicar-como-si-fuera-junior.md": "starter-prompts/explicar-como-si-fuera-junior.md",
      "prompts/hacer-mas-conciso.md": "starter-prompts/hacer-mas-conciso.md",
      "prompts/hacer-mas-formal.md": "starter-prompts/hacer-mas-formal.md",
      "prompts/like-me.md": "starter-prompts/like-me.md",
      "prompts/manual.md": "starter-prompts/manual.md",
      "prompts/reescribir-como-commit-message.md": "starter-prompts/reescribir-como-commit-message.md",
      "prompts/reescribir-como-mensaje-de-slack.md": "starter-prompts/reescribir-como-mensaje-de-slack.md",
      "prompts/resumir.md": "starter-prompts/resumir.md",
      "prompts/traducir-a-espanol.md": "starter-prompts/traducir-a-espanol.md",
      "prompts/traducir-a-ingles.md": "starter-prompts/traducir-a-ingles.md",
    },
    win: {
      bundleCEF: false,
    },
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
