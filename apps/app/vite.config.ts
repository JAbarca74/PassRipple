import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * Lets the app call the API and nothing else (I8): the API's origin replaces
 * __API_ORIGIN__ in connect-src of the built `_headers`.
 */
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
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), tailwindcss(), apiOriginCsp(env.VITE_API_URL)],
    server: { port: 5174, strictPort: true },
    preview: { port: 5174, strictPort: true },
  };
});
