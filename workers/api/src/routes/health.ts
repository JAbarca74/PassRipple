// Liveness of the Worker, and of its path to the database through Hyperdrive.

import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { SYSTEM_ACTOR } from "../db.ts";

export const healthRoutes = new Hono<AppEnv>()
  .get("/", (c) => c.json({ status: "ok", serverTime: Date.now() }))
  .get("/db", async (c) => {
    await c.var.db.transaction(SYSTEM_ACTOR, (tx) => tx`SELECT 1`);
    return c.json({ status: "ok", database: "ok", serverTime: Date.now() });
  });
