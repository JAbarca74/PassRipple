import { describe, expect, test } from "vitest";
import type { Env } from "./env.ts";
import { reviewerCode } from "./reviewer.ts";

function makeEnv(email?: string, code?: string): Env {
  return {
    REVIEW_SIGN_IN_EMAIL: email,
    REVIEW_SIGN_IN_CODE: code,
  } as Env;
}

describe("reviewerCode", () => {
  test("returns the code for the configured address", () => {
    const env = makeEnv("reviewer@example.com", "123456");
    expect(reviewerCode(env, "reviewer@example.com")).toBe("123456");
  });

  test("matches address case-insensitively and ignoring surrounding spaces, and trims the code", () => {
    const env = makeEnv("  Reviewer@Example.COM \n", "  654321\t ");
    expect(reviewerCode(env, "\t reviewer@example.com  ")).toBe("654321");
    expect(reviewerCode(env, "REVIEWER@EXAMPLE.COM")).toBe("654321");
  });

  test("returns null for another address", () => {
    const env = makeEnv("reviewer@example.com", "123456");
    expect(reviewerCode(env, "other@example.com")).toBeNull();
    expect(reviewerCode(env, "")).toBeNull();
  });

  test("returns null when REVIEW_SIGN_IN_EMAIL or REVIEW_SIGN_IN_CODE is unset or empty/blank", () => {
    expect(reviewerCode(makeEnv(undefined, "123456"), "reviewer@example.com")).toBeNull();
    expect(reviewerCode(makeEnv("", "123456"), "reviewer@example.com")).toBeNull();
    expect(reviewerCode(makeEnv("   ", "123456"), "reviewer@example.com")).toBeNull();

    expect(
      reviewerCode(makeEnv("reviewer@example.com", undefined), "reviewer@example.com"),
    ).toBeNull();
    expect(reviewerCode(makeEnv("reviewer@example.com", ""), "reviewer@example.com")).toBeNull();
    expect(reviewerCode(makeEnv("reviewer@example.com", "   "), "reviewer@example.com")).toBeNull();
  });

  test("throws for a configured code that is not six digits when the address matches", () => {
    expect(() =>
      reviewerCode(makeEnv("reviewer@example.com", "12345"), "reviewer@example.com"),
    ).toThrow(/must be six digits/);
    expect(() =>
      reviewerCode(makeEnv("reviewer@example.com", "1234567"), "reviewer@example.com"),
    ).toThrow(/must be six digits/);
    expect(() =>
      reviewerCode(makeEnv("reviewer@example.com", "12345a"), "reviewer@example.com"),
    ).toThrow(/must be six digits/);
  });

  test("does not throw for a malformed code when the address does not match", () => {
    const env = makeEnv("reviewer@example.com", "bad-code");
    expect(reviewerCode(env, "other@example.com")).toBeNull();
  });
});
