import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const COMING_SOON_PAGE = "coming-soon.html";

/**
 * Serves and builds the holding page as the whole site, at `/`.
 * Cloudflare Pages then answers every other path with that same page.
 */
function comingSoon(): Plugin {
  return {
    name: "passripple:coming-soon",
    // Runs after Vite's HTML plugin, which emits the page in its own generateBundle.
    enforce: "post",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/" || req.url === "/index.html") req.url = `/${COMING_SOON_PAGE}`;
        next();
      });
    },
    generateBundle(_options, bundle) {
      const page = bundle[COMING_SOON_PAGE];
      if (page) page.fileName = "index.html";
    },
  };
}

export default defineConfig(({ mode }) => {
  const isComingSoon = mode === "coming-soon";
  return {
    plugins: isComingSoon ? [comingSoon()] : [react(), tailwindcss()],
    build: isComingSoon ? { rollupOptions: { input: COMING_SOON_PAGE } } : {},
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true },
  };
});
