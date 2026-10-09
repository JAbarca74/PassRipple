import type { Context } from "hono";
import { describe, expect, test, vi } from "vitest";
import { ApiError, errorResponse, toMapped } from "./errors.ts";

describe("ApiError", () => {
  test("creates an ApiError", () => {
    const error = new ApiError(400, "bad", "message");
    expect(error.status).toBe(400);
    expect(error.code).toBe("bad");
    expect(error.message).toBe("message");
    expect(error instanceof Error).toBe(true);
  });
});

describe("toMapped", () => {
  test("returns the ApiError directly", () => {
    const error = new ApiError(401, "unauth", "Go away");
    const mapped = toMapped(error);
    expect(mapped).toEqual({ status: 401, code: "unauth", message: "Go away" });
  });

  test("maps known SQLSTATE codes", () => {
    expect(toMapped({ code: "42501" })).toEqual({
      status: 403,
      code: "forbidden",
      message: "Not allowed for this actor.",
    });
    expect(toMapped({ code: "PR429" })).toEqual({
      status: 429,
      code: "rate_limited",
      message: "Too many attempts. Try again later.",
    });
    expect(toMapped({ code: "23505" })).toEqual({
      status: 409,
      code: "conflict",
      message: "The request conflicts with current state.",
    });
  });

  test("maps unknown SQLSTATE to 500 internal", () => {
    expect(toMapped({ code: "99999" })).toEqual({
      status: 500,
      code: "internal",
      message: "Something went wrong.",
    });
  });

  test("maps non-objects and missing codes to 500 internal", () => {
    expect(toMapped(null)).toEqual({
      status: 500,
      code: "internal",
      message: "Something went wrong.",
    });
    expect(toMapped(undefined)).toEqual({
      status: 500,
      code: "internal",
      message: "Something went wrong.",
    });
    expect(toMapped("string error")).toEqual({
      status: 500,
      code: "internal",
      message: "Something went wrong.",
    });
    expect(toMapped({ message: "no code" })).toEqual({
      status: 500,
      code: "internal",
      message: "Something went wrong.",
    });
    expect(toMapped({ code: 123 })).toEqual({
      status: 500,
      code: "internal",
      message: "Something went wrong.",
    });
  });
});

describe("errorResponse", () => {
  test("returns a JSON response", () => {
    const mockJson = vi.fn().mockReturnValue("response");
    const ctx = { json: mockJson } as unknown as Context;

    const error = new ApiError(404, "not_found", "Item missing");
    const result = errorResponse(error, ctx);

    expect(result).toBe("response");
    expect(mockJson).toHaveBeenCalledWith(
      { error: { code: "not_found", message: "Item missing" } },
      404,
    );
  });

  test("logs the error if status is >= 500", () => {
    const mockJson = vi.fn().mockReturnValue("response");
    const ctx = { json: mockJson } as unknown as Context;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const error = new Error("Boom");
    errorResponse(error, ctx);

    expect(consoleSpy).toHaveBeenCalledWith(error);
    consoleSpy.mockRestore();
  });

  test("does not log if status < 500", () => {
    const mockJson = vi.fn().mockReturnValue("response");
    const ctx = { json: mockJson } as unknown as Context;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    errorResponse(new ApiError(400, "bad", "bad"), ctx);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
