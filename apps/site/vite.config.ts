import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const COMING_SOON_PAGE = "coming-soon.html";
const SITE_PAGE = "site.html";
/** Pages that must be public even while the site is "coming soon": Play Store links (14.5, 14.7). */
const ALWAYS_PUBLIC = ["/privacidad", "/terminos", "/eliminar-datos"];

/**
 * Serves and builds the holding page as the whole site, at `/`, except the legal pages,
 * which the static assets rewrite to the full site (`_redirects`). Every other path gets
 * the holding page.
 */
function comingSoon(): Plugin {
  return {
    name: "passripple:coming-soon",
    // Runs after Vite's HTML plugin, which emits the pages in its own generateBundle.
    enforce: "post",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/" || req.url === "/index.html") req.url = `/${COMING_SOON_PAGE}`;
        next();
      });
    },
    generateBundle(_options, bundle) {
      const site = bundle["index.html"];
      if (site) site.fileName = SITE_PAGE;
      const page = bundle[COMING_SOON_PAGE];
      if (page) page.fileName = "index.html";
      this.emitFile({
        type: "asset",
        fileName: "_redirects",
        source: `${ALWAYS_PUBLIC.map((path) => `${path} /${SITE_PAGE} 200`).join("\n")}\n`,
      });
    },
  };
}

/** Lets the pages call the API: its origin joins connect-src in the built `_headers`. */
function apiOriginCsp(apiUrl: string | undefined): Plugin {
  let outDir = "dist";
  return {
    name: "passripple:api-origin-csp",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const file = join(outDir, "_headers");
      const origin = apiUrl ? new URL(apiUrl).origin : "";
      writeFileSync(
        file,
        readFileSync(file, "utf8").replaceAll(" __API_ORIGIN__", origin ? ` ${origin}` : ""),
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const isComingSoon = mode === "coming-soon";
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const plugins = [react(), tailwindcss(), apiOriginCsp(env.VITE_API_URL)];
  return {
    plugins: isComingSoon ? [...plugins, comingSoon()] : plugins,
    build: isComingSoon ? { rollupOptions: { input: [COMING_SOON_PAGE, "index.html"] } } : {},
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true },
  };
});
