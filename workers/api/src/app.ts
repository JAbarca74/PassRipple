// The HTTP API and composition root: it wires the routes to the database and to the ports
// of external providers (rule R5). Everything a route needs arrives through the context, so
// the app can be built with fakes.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { edgeCache, type ResponseCache } from "./cache.ts";
import { origins } from "./config.ts";
import type { Database } from "./db.ts";
import type { Env } from "./env.ts";
import { errorResponse } from "./errors.ts";
import type { IntegrityVerifier } from "./ports/integrity.ts";
import type { MailSender } from "./ports/mail.ts";
import { accountRoutes } from "./routes/account.ts";
import { adminRoutes } from "./routes/admin.ts";
import { attendeeRoutes } from "./routes/attendees.ts";
import { authRoutes } from "./routes/auth.ts";
import { buyerRoutes } from "./routes/buyer.ts";
import { courtesyRoutes } from "./routes/courtesies.ts";
import { eventRoutes } from "./routes/events.ts";
import { gateRoutes } from "./routes/gate.ts";
import { healthRoutes } from "./routes/health.ts";
import { municipalRoutes } from "./routes/municipal.ts";
import { orderRoutes } from "./routes/orders.ts";
import { reportingRoutes } from "./routes/reporting.ts";
import { adminSettlementRoutes, settlementRoutes } from "./routes/settlement.ts";
import { staffRoutes } from "./routes/staff.ts";
import { transferRoutes } from "./routes/transfers.ts";
import { walletRoutes } from "./routes/wallet.ts";
import { waitUntil } from "./wait-until.ts";

/** What the app needs from outside, built per request from the Worker's bindings. */
export interface Services {
  database(env: Env): Database;
  mailer(env: Env, requestUrl: string): MailSender;
  integrity(env: Env): IntegrityVerifier;
  /** The edge cache for public reads (9.3); without it every read reaches the database. */
  cache?(): ResponseCache;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Database;
    /** Built on first use, so a misconfigured mailer only fails the routes that send mail. */
    mailer: () => MailSender;
    integrity: IntegrityVerifier;
    cache: ResponseCache | null;
  };
}

/** Header carrying the server's clock, in milliseconds, on every response. */
export const SERVER_TIME_HEADER = "X-Server-Time";

export function createApp(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>().basePath("/v1");

  app.use(async (c, next) => {
    const db = services.database(c.env);
    c.set("db", db);
    c.set("mailer", () => services.mailer(c.env, c.req.url));
    c.set("integrity", services.integrity(c.env));
    c.set("cache", services.cache?.() ?? null);
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
  // Sign-in also serves the organizer and administration panels of the app.
  const signInCors = cors({
    origin: (origin, c) =>
      [...origins(c.env.ALLOWED_ORIGINS), ...origins(c.env.APP_ORIGINS)].includes(origin)
        ? origin
        : null,
    allowMethods: ["POST"],
    allowHeaders: ["content-type", "authorization"],
    exposeHeaders: [SERVER_TIME_HEADER],
    maxAge: 600,
  });
  app.use("/auth/*", signInCors);
  app.use("/account", browserCors);
  app.use("/buyer/*", browserCors);

  // The panels of the app: who the session is and settlement. Organizers name their
  // organization in X-Org-Id. Only the origins in APP_ORIGINS may.
  const panelCors = cors({
    origin: (origin, c) => (origins(c.env.APP_ORIGINS).includes(origin) ? origin : null),
    allowMethods: ["GET", "POST"],
    allowHeaders: ["content-type", "authorization", "x-org-id"],
    exposeHeaders: [SERVER_TIME_HEADER],
    maxAge: 600,
  });
  app.use("/account/me", panelCors);
  app.use("/settlement/*", panelCors);
  app.use("/reporting/*", panelCors);
  app.use("/admin/settlement/*", panelCors);
  app.use("/courtesies/*", panelCors);
  app.use("/municipal/*", panelCors);
  app.use("/admin/inspectors/*", panelCors);
  app.use("/admin/inspectors", panelCors);
  app.use("/staff/devices/*", panelCors);
  app.use("/staff/blocks/*", panelCors);
  app.use("/staff/events/*", panelCors);
  app.use("/staff/codes", panelCors);

  // The app (app.<domain>) calls the buyer's routes: events, orders, the wallet and transfers. Only the
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
  app.use("/wallet", appCors);
  app.use("/wallet/*", appCors);
  app.use("/transfers", appCors);
  app.use("/transfers/*", appCors);
  app.use("/attendees", appCors);

  // The event page and the public listing are read by every visitor: served from the edge
  // cache for as long as each route's Cache-Control allows (design 9.3). "/events/*" also
  // matches "/events" itself.
  app.use("/events/*", edgeCache());

  app.route("/health", healthRoutes);
  app.route("/auth", authRoutes);
  app.route("/staff", staffRoutes);
  app.route("/gate", gateRoutes);
  app.route("/account", accountRoutes);
  app.route("/admin/settlement", adminSettlementRoutes);
  app.route("/admin", adminRoutes);
  app.route("/settlement", settlementRoutes);
  app.route("/reporting", reportingRoutes);
  app.route("/buyer", buyerRoutes);
  app.route("/events", eventRoutes);
  app.route("/orders", orderRoutes);
  app.route("/wallet", walletRoutes);
  app.route("/transfers", transferRoutes);
  app.route("/attendees", attendeeRoutes);
  app.route("/courtesies", courtesyRoutes);
  app.route("/municipal", municipalRoutes);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found." } }, 404));
  app.onError((error, c) => {
    const response = errorResponse(error, c);
    response.headers.set(SERVER_TIME_HEADER, String(Date.now()));
    return response;
  });

  return app;
}
