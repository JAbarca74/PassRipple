import { describe, expect, it } from "vitest";
import { csvDocument } from "./csv.ts";

describe("csvDocument", () => {
  it("quotes every cell, leaves nulls empty and ends lines with CRLF", () => {
    expect(csvDocument([["a", 1, null], []])).toBe('"a","1",""\r\n\r\n');
  });

  it("doubles quotes inside a cell", () => {
    expect(csvDocument([['say "hi"']])).toBe('"say ""hi"""\r\n');
  });

  it("neutralizes text a spreadsheet would run as a formula, but not numbers", () => {
    expect(csvDocument([["=1+1", "+x", "-x", "@x", -5]])).toBe(
      `"'=1+1","'+x","'-x","'@x","-5"\r\n`,
    );
  });
});
