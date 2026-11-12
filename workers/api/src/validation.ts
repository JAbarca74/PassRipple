// Untrusted input checked against the shared schemas of @passripple/contracts.

import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "./errors.ts";

export async function jsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_request", "The body must be JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid request.");
  return parsed.data;
}

export function param<S extends z.ZodType>(value: string | undefined, schema: S): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid request.");
  return parsed.data;
}

/** A timestamp from the database (a Date) as ISO 8601 text, keeping NULL. */
export function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function isoRequired(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
