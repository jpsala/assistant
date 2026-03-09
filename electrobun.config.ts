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
    },
    copy: {
      "src/views/mainview/index.html": "views/mainview/index.html",
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
