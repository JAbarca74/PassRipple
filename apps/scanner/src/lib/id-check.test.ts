import { describe, expect, test } from "vitest";
import { captureComplete, idCheckTitle } from "./id-check.ts";

describe("idCheckTitle", () => {
  test("names the age to check, or only the document for named all-ages events", () => {
    expect(idCheckTitle({ ageRating: "18plus", named: true, attendee: null })).toBe(
      "VERIFICAR MAYORÍA DE EDAD",
    );
    expect(idCheckTitle({ ageRating: "12plus", named: false, attendee: null })).toBe(
      "VERIFICAR EDAD 12+",
    );
    expect(idCheckTitle({ ageRating: "all", named: true, attendee: null })).toBe(
      "VERIFICAR DOCUMENTO",
    );
  });
});

describe("captureComplete", () => {
  test("needs a name and two to four letters or digits", () => {
    expect(captureComplete("Ana Mora", "6789")).toBe(true);
    expect(captureComplete(" Ana ", " ab ")).toBe(true);
    expect(captureComplete("A", "6789")).toBe(false);
    expect(captureComplete("Ana Mora", "7")).toBe(false);
    expect(captureComplete("Ana Mora", "12345")).toBe(false);
    expect(captureComplete("Ana Mora", "12-4")).toBe(false);
  });
});
