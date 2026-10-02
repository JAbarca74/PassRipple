import { describe, expect, test } from "vitest";
import { GATE_MANIFEST_VERSION } from "./gate-manifest.ts";

describe("gate-manifest", () => {
  test("has GATE_MANIFEST_VERSION = 1", () => {
    expect(GATE_MANIFEST_VERSION).toBe(1);
  });
});
