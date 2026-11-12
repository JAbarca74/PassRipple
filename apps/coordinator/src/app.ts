// The coordinator's HTTP surface: one route to claim a ticket and a health check. Every
// route but health needs the zone's shared token, which the organizer hands to the gates;
// the coordinator runs on a laptop in the venue and is not reachable from the internet.

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { ClaimStore } from "./claims.ts";

const claimRequest = z.object({ ticketId: z.uuid(), deviceId: z.uuid() });

function sameToken(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCoordinatorApp(
  store: ClaimStore,
  token: string,
  now: () => number = Date.now,
): Hono {
  if (token.length < 16) throw new Error("the coordinator token must have at least 16 characters");
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, claims: store.count() }));

  app.use("/v1/*", async (c, next) => {
    if (!sameToken(c.req.header("x-coordinator-token"), token)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.post("/v1/claim", async (c) => {
    const body = claimRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    return c.json(store.claim(body.data.ticketId, body.data.deviceId, now()));
  });

  return app;
}
