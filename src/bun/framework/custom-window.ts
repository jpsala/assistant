import { resolve } from "node:path";
import { BrowserWindow, type BrowserWindowConstructorOptions } from "electrobun/bun";
import type { createLogger } from "../logger";
// @ts-ignore — Electrobun internal, not in public exports
import { native, toCString } from "../../../node_modules/electrobun/dist/api/bun/proc/native";

type Logger = ReturnType<typeof createLogger>;

type SharedRouteContext = {
  windowRef: () => BrowserWindow | null;
  clearWindowRef: () => void;
  log: Logger;
};

type ServerOptions = {
  log: Logger;
  viewName: string;
  headScript: string | ((port: number) => string);
  handleRequest?: (req: Request, path: string) => Promise<Response | null | undefined>;
  context: SharedRouteContext;
};

export type WindowServer = {
  port: number;
  server: ReturnType<typeof Bun.serve>;
};

type LoggerLike = {
  debug?(event: string, meta?: Record<string, unknown>): void;
  info?(event: string, meta?: Record<string, unknown>): void;
  warn?(event: string, meta?: Record<string, unknown>): void;
  error?(event: string, meta?: Record<string, unknown>): void;
};

type WindowGetter = () => BrowserWindow | null;

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

export async function resolveViewAssets(
  log: Logger,
  viewName: string,
): Promise<{ js: string; html: string }> {
  const builtViewDir = resolve(import.meta.dir, `../views/${viewName}`);
  const srcViewDir = resolve(process.cwd(), `src/views/${viewName}`);
  const builtJs = resolve(builtViewDir, "index.js");
  const srcTs = resolve(srcViewDir, "index.ts");

  let js: string;
  if (await fileExists(builtJs)) {
    log.info("assets.using_built_js", { viewName });
    js = await Bun.file(builtJs).text();
  } else if (await fileExists(srcTs)) {
    log.info("assets.bundling_from_source", { viewName });
    const result = await Bun.build({
      entrypoints: [srcTs],
      target: "browser",
      format: "esm",
    });
    if (!result.success) {
      throw new Error(result.logs.map((entry) => entry.message).join("\n"));
    }
    js = await result.outputs[0].text();
  } else {
    throw new Error(`view not found for ${viewName}: ${builtJs} | ${srcTs}`);
  }

  const builtHtml = resolve(builtViewDir, "index.html");
  const srcHtml = resolve(srcViewDir, "index.html");
  const htmlPath = (await fileExists(builtHtml)) ? builtHtml : srcHtml;
  const html = await Bun.file(htmlPath).text();
  return { js, html };
}

export async function ensureWindowServer(options: ServerOptions): Promise<WindowServer> {
  const { log, viewName, headScript, handleRequest, context } = options;
  const { js, html } = await resolveViewAssets(log, viewName);
  const finalHtml = html.replace(
    /<script type="module" src="index\.ts"><\/script>/,
    `<script type="module" src="/index.js"></script>`,
  );

  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/" || path === "/index.html") {
        const script = typeof headScript === "function" ? headScript(server.port) : headScript;
        const payload = finalHtml.replace("</head>", `<script>${script}</script>\n</head>`);
        return new Response(payload, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (path === "/index.js") {
        return new Response(js, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }

      if (req.method === "POST" && path === "/close") {
        const window = context.windowRef();
        if (window) {
          try { window.close(); } catch {}
          context.clearWindowRef();
        }
        return new Response("ok");
      }

      if (req.method === "POST" && path === "/window/resize") {
        const body = await req.json() as { width?: number; height?: number };
        const window = context.windowRef();
        if (window && body.width && body.height) {
          window.setSize(body.width, body.height);
        }
        return new Response("ok");
      }

      if (req.method === "POST" && path === "/window/minimize") {
        const window = context.windowRef();
        try {
          window?.minimize();
        } catch (error) {
          context.log.warn("window.minimize_failed", { error });
        }
        return new Response("ok");
      }

      if (req.method === "POST" && path === "/window/maximize-toggle") {
        const window = context.windowRef();
        try {
          if (window?.isMaximized()) window.unmaximize();
          else window?.maximize();
        } catch (error) {
          context.log.warn("window.maximize_toggle_failed", { error });
        }
        return new Response("ok");
      }

      if (req.method === "POST" && path === "/window/focus") {
        const window = context.windowRef();
        try {
          window?.show();
          window?.focus();
          window?.setAlwaysOnTop(true);
          window?.setAlwaysOnTop(false);
        } catch (error) {
          context.log.warn("window.focus_failed", { error });
        }
        return new Response("ok");
      }

      if (req.method === "GET" && path === "/window/state") {
        const window = context.windowRef();
        return Response.json({
          maximized: window?.isMaximized() ?? false,
          minimized: window?.isMinimized() ?? false,
        });
      }

      if (req.method === "GET" && path === "/window/frame") {
        const window = context.windowRef();
        const frame = window?.getFrame();
        if (!frame) {
          return Response.json({ error: "window not ready" }, { status: 503 });
        }
        return Response.json(frame);
      }

      if (req.method === "POST" && path === "/window/frame") {
        const window = context.windowRef();
        const body = await req.json() as {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
        };
        if (
          window &&
          Number.isFinite(body.x) &&
          Number.isFinite(body.y) &&
          Number.isFinite(body.width) &&
          Number.isFinite(body.height)
        ) {
          const x = body.x as number;
          const y = body.y as number;
          const w = body.width as number;
          const h = body.height as number;
          window.setFrame(x, y, w, h);
          const wv = window.webview;
          if (wv?.ptr) {
            native.symbols.resizeWebview(wv.ptr, 0, 0, w, h, toCString("[]"));
          }
        }
        return new Response("ok");
      }

      if (req.method === "POST" && path === "/log") {
        const body = await req.json() as {
          level?: "debug" | "info" | "warn" | "error";
          event?: string;
          meta?: Record<string, unknown>;
        };
        const level = body.level ?? "info";
        const event = body.event ?? "webview.event";
        const meta = body.meta ?? {};
        if (level === "debug") log.debug(`webview.${event}`, meta);
        else if (level === "warn") log.warn(`webview.${event}`, meta);
        else if (level === "error") log.error(`webview.${event}`, meta);
        else log.info(`webview.${event}`, meta);
        return new Response("ok");
      }

      return (await handleRequest?.(req, path)) ?? new Response("Not found", { status: 404 });
    },
  });

  log.info("server.ready", { viewName, port: server.port });
  return { port: server.port, server };
}

export function createTransparentWindow(
  options: BrowserWindowConstructorOptions,
): BrowserWindow {
  return new BrowserWindow({
    ...options,
    html: null,
    titleBarStyle: "hidden",
    transparent: true,
  });
}

export function createHiddenTitlebarWindow(
  options: BrowserWindowConstructorOptions & { transparent?: boolean },
): BrowserWindow {
  return new BrowserWindow({
    ...options,
    html: null,
    titleBarStyle: "hidden",
    transparent: options.transparent ?? false,
  });
}

export function createCustomWindow(
  title: string,
  frame: { x: number; y: number; width: number; height: number },
  url: string,
  options: { transparent?: boolean } = {},
): BrowserWindow {
  return createHiddenTitlebarWindow({
    title,
    frame,
    url,
    transparent: options.transparent ?? true,
  });
}

export async function handleCustomWindowRequest(
  req: Request,
  pathname: string,
  getWindow: WindowGetter,
  log?: LoggerLike,
): Promise<Response | null> {
  const window = getWindow();

  if (req.method === "POST" && pathname === "/close") {
    try {
      window?.close();
    } catch {}
    return new Response("ok");
  }

  if (req.method === "POST" && pathname === "/window/minimize") {
    try {
      window?.minimize();
    } catch (error) {
      log?.warn?.("window.minimize_failed", { error });
    }
    return new Response("ok");
  }

  if (req.method === "POST" && pathname === "/window/maximize-toggle") {
    try {
      if (window?.isMaximized()) window.unmaximize();
      else window?.maximize();
    } catch (error) {
      log?.warn?.("window.maximize_toggle_failed", { error });
    }
    return new Response("ok");
  }

  if (req.method === "POST" && pathname === "/window/focus") {
    try {
      window?.show();
      window?.focus();
      window?.setAlwaysOnTop(true);
      window?.setAlwaysOnTop(false);
    } catch (error) {
      log?.warn?.("window.focus_failed", { error });
    }
    return new Response("ok");
  }

  if (req.method === "GET" && pathname === "/window/state") {
    return Response.json({
      maximized: window?.isMaximized() ?? false,
      minimized: window?.isMinimized() ?? false,
    });
  }

  if (req.method === "GET" && pathname === "/window/frame") {
    const frame = window?.getFrame();
    if (!frame) return Response.json({ error: "window not ready" }, { status: 503 });
    return Response.json(frame);
  }

  if (req.method === "POST" && pathname === "/window/frame") {
    const body = await req.json() as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    };
    if (
      window &&
      Number.isFinite(body.x) &&
      Number.isFinite(body.y) &&
      Number.isFinite(body.width) &&
      Number.isFinite(body.height)
    ) {
      const x = body.x as number;
      const y = body.y as number;
      const w = body.width as number;
      const h = body.height as number;
      window.setFrame(x, y, w, h);
      // Also resize the WebView2 surface — setFrame only calls SetWindowPos on
      // the outer HWND; without this the WebView2 bounds stay at the original
      // size and the expanded area is transparent/click-through.
      const wv = window.webview;
      if (wv?.ptr) {
        native.symbols.resizeWebview(wv.ptr, 0, 0, w, h, toCString("[]"));
      }
    }
    return new Response("ok");
  }

  if (req.method === "POST" && pathname === "/log") {
    const body = await req.json() as {
      level?: "debug" | "info" | "warn" | "error";
      event?: string;
      meta?: Record<string, unknown>;
    };
    const level = body.level ?? "info";
    const event = body.event ?? "webview.event";
    const meta = body.meta ?? {};
    if (level === "debug") log?.debug?.(`webview.${event}`, meta);
    else if (level === "warn") log?.warn?.(`webview.${event}`, meta);
    else if (level === "error") log?.error?.(`webview.${event}`, meta);
    else log?.info?.(`webview.${event}`, meta);
    return new Response("ok");
  }

  return null;
}
