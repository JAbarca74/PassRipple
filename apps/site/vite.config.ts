import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const COMING_SOON_PAGE = "coming-soon.html";
/** Served by the static assets, with status 404, for every path that is not a file. */
const NOT_FOUND_PAGE = "404.html";

/**
 * Serves and builds the holding page as the whole site, at `/`. Every other path gets the
 * not-found page (404.html) with status 404, so search engines index only the home page.
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
    build: isComingSoon ? { rollupOptions: { input: [COMING_SOON_PAGE, NOT_FOUND_PAGE] } } : {},
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true },
  };
});
