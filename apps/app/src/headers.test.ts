// Invariant I8 and design 13.5, checked on every change: the app (where the buyer's keys and
// personal data live) allows no third-party origin in its Content Security Policy, loads no
// external script, and is never indexed by search engines.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDir = new URL("../", import.meta.url);
const headers = readFileSync(new URL("public/_headers", appDir), "utf8");
const indexHtml = readFileSync(new URL("index.html", appDir), "utf8");

function header(name: string): string {
  const line = headers.split("\n").find((entry) => entry.trim().startsWith(`${name}:`));
  if (!line) throw new Error(`missing header ${name}`);
  return line.slice(line.indexOf(":") + 1).trim();
}

describe("app headers (I8, 13.5)", () => {
  test("every response is noindex", () => {
    expect(header("X-Robots-Tag")).toBe("noindex");
  });

  test("the CSP names no origin but its own and the API's placeholder", () => {
    const csp = header("Content-Security-Policy");
    const sources = csp
      .split(";")
      .flatMap((directive) => directive.trim().split(/\s+/).slice(1))
      .filter((source) => source !== "");
    const allowed = new Set(["'self'", "'none'", "data:", "__API_ORIGIN__"]);
    expect(sources.filter((source) => !allowed.has(source))).toEqual([]);
    expect(csp).toMatch(/script-src 'self'(;|$)/);
  });

  test("index.html loads no external script, style or font", () => {
    const external = [...indexHtml.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)];
    expect(external).toEqual([]);
  });
});
