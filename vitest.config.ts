import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.db.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "modules/*/src/**", "scripts/lib/**"],
      exclude: ["**/*.test.ts", "packages/*/src/index.ts", "modules/*/src/index.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: {
        "packages/**": { lines: 100, branches: 100, functions: 100, statements: 100 },
        "scripts/lib/**": { lines: 90, branches: 90, functions: 90, statements: 90 },
        "modules/**": { lines: 80, branches: 80, functions: 80, statements: 80 },
      },
    },
  },
});
