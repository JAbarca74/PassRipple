// The HTTP API and composition root: it wires the routes to the database and to the ports
// of external providers (rule R5). Everything a route needs arrives through the context, so
// the app can be built with fakes.

import { Hono } from "hono";
import type { Database } from "./db.ts";
import type { Env } from "./env.ts";
import { errorResponse } from "./errors.ts";
import { healthRoutes } from "./routes/health.ts";

/** What the app needs from outside, built once per request from the Worker's bindings. */
export interface Services {
  database(env: Env): Database;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { db: Database };
}

/** Header carrying the server's clock, in milliseconds, on every response. */
export const SERVER_TIME_HEADER = "X-Server-Time";

function waitUntil(
  c: { executionCtx: { waitUntil(promise: Promise<unknown>): void } },
  promise: Promise<unknown>,
): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // No execution context (outside the Workers runtime): nothing outlives the request.
    void promise.catch(() => {});
  }
}

export function createApp(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>().basePath("/v1");

  app.use(async (c, next) => {
    const db = services.database(c.env);
    c.set("db", db);
    try {
      await next();
    } finally {
      waitUntil(c, db.close());
    }
    // Gate devices correct their clock with it (design 6.3, step 3).
    c.header(SERVER_TIME_HEADER, String(Date.now()));
  });

  app.route("/health", healthRoutes);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found." } }, 404));
  app.onError((error, c) => {
    const response = errorResponse(error, c);
    response.headers.set(SERVER_TIME_HEADER, String(Date.now()));
    return response;
  });

  return app;
}
