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
    },
    copy: {
      "src/views/mainview/index.html": "views/mainview/index.html",
      "src/views/picker/index.html": "views/picker/index.html",
      // Starter prompts shipped with the app (seeded to %APPDATA% on first run)
      "prompts/fix-writing.md": "starter-prompts/fix-writing.md",
      "prompts/translate-english.md": "starter-prompts/translate-english.md",
      "prompts/summarize.md": "starter-prompts/summarize.md",
      "prompts/explain-code.md": "starter-prompts/explain-code.md",
      "prompts/improve-email.md": "starter-prompts/improve-email.md",
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
