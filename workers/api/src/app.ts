// The HTTP API and composition root: it wires the routes to the database and to the ports
// of external providers (rule R5). Everything a route needs arrives through the context, so
// the app can be built with fakes.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { origins } from "./config.ts";
import type { Database } from "./db.ts";
import type { Env } from "./env.ts";
import { errorResponse } from "./errors.ts";
import type { IntegrityVerifier } from "./ports/integrity.ts";
import type { MailSender } from "./ports/mail.ts";
import { accountRoutes } from "./routes/account.ts";
import { authRoutes } from "./routes/auth.ts";
import { eventRoutes } from "./routes/events.ts";
import { gateRoutes } from "./routes/gate.ts";
import { healthRoutes } from "./routes/health.ts";
import { orderRoutes } from "./routes/orders.ts";
import { staffRoutes } from "./routes/staff.ts";

/** What the app needs from outside, built per request from the Worker's bindings. */
export interface Services {
  database(env: Env): Database;
  mailer(env: Env, requestUrl: string): MailSender;
  integrity(env: Env): IntegrityVerifier;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Database;
    /** Built on first use, so a misconfigured mailer only fails the routes that send mail. */
    mailer: () => MailSender;
    integrity: IntegrityVerifier;
  };
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
    c.set("mailer", () => services.mailer(c.env, c.req.url));
    c.set("integrity", services.integrity(c.env));
    try {
      await next();
    } finally {
      waitUntil(c, db.close());
    }
    // Gate devices correct their clock with it (design 6.3, step 3).
    c.header(SERVER_TIME_HEADER, String(Date.now()));
  });

  // The public site calls sign-in and account erasure from the browser (/eliminar-datos).
  // Only the origins in ALLOWED_ORIGINS may; nothing else is reachable cross-origin.
  const browserCors = cors({
    origin: (origin, c) => (origins(c.env.ALLOWED_ORIGINS).includes(origin) ? origin : null),
    allowMethods: ["POST", "DELETE"],
    allowHeaders: ["content-type", "authorization"],
    exposeHeaders: [SERVER_TIME_HEADER],
    maxAge: 600,
  });
  app.use("/auth/*", browserCors);
  app.use("/account", browserCors);

  // The app (app.<domain>) calls the buyer's routes: events, orders and the wallet. Only the
  // origins in APP_ORIGINS may. The idempotency key and the order's token travel in headers.
  const appCors = cors({
    origin: (origin, c) => (origins(c.env.APP_ORIGINS).includes(origin) ? origin : null),
    allowMethods: ["GET", "POST"],
    allowHeaders: ["content-type", "authorization", "idempotency-key"],
    exposeHeaders: [SERVER_TIME_HEADER],
    maxAge: 600,
  });
  app.use("/events/*", appCors);
  app.use("/orders", appCors);
  app.use("/orders/*", appCors);

  app.route("/health", healthRoutes);
  app.route("/auth", authRoutes);
  app.route("/staff", staffRoutes);
  app.route("/gate", gateRoutes);
  app.route("/account", accountRoutes);
  app.route("/events", eventRoutes);
  app.route("/orders", orderRoutes);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found." } }, 404));
  app.onError((error, c) => {
    const response = errorResponse(error, c);
    response.headers.set(SERVER_TIME_HEADER, String(Date.now()));
    return response;
  });

  return app;
}
