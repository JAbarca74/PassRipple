// Errors the client sees: an HTTP status and a stable code. Database errors are mapped by
// their SQLSTATE; their messages stay in the Worker's logs, never in a response, because a
// constraint message can carry values from the row.

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error meant for the client: the code is stable, the message is for people. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface Mapped {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly message: string;
}

// SQLSTATE codes raised by the module functions and constraints, and what they mean here.
const SQLSTATE: Readonly<Record<string, Mapped>> = {
  "42501": { status: 403, code: "forbidden", message: "Not allowed for this actor." },
  "28000": { status: 401, code: "unauthorized", message: "Not signed in." },
  P0002: { status: 404, code: "not_found", message: "Not found." },
  // A phone of the account is still enrolled and may hold scans to upload.
  "55006": {
    status: 409,
    code: "device_enrolled",
    message: "A phone of this account is still enrolled. Sign out of the event in the app first.",
  },
  // Raised by module functions that limit how often something may happen.
  PR429: { status: 429, code: "rate_limited", message: "Too many attempts. Try again later." },
  "22023": { status: 400, code: "invalid_request", message: "Invalid request." },
  "22P02": { status: 400, code: "invalid_request", message: "Invalid request." },
  "23502": { status: 400, code: "invalid_request", message: "Invalid request." },
  "23514": { status: 409, code: "conflict", message: "The request conflicts with current state." },
  "23001": { status: 409, code: "conflict", message: "The request conflicts with current state." },
  "23503": { status: 409, code: "conflict", message: "The request conflicts with current state." },
  "23505": { status: 409, code: "conflict", message: "The request conflicts with current state." },
};

const INTERNAL: Mapped = { status: 500, code: "internal", message: "Something went wrong." };

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

export function toMapped(error: unknown): Mapped {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  const state = sqlState(error);
  return (state && SQLSTATE[state]) || INTERNAL;
}

export function errorResponse(error: unknown, c: Context): Response {
  const mapped = toMapped(error);
  if (mapped.status >= 500) console.error(error);
  return c.json({ error: { code: mapped.code, message: mapped.message } }, mapped.status);
}
