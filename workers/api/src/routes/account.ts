// Account erasure (design 14.7), from the gate app and from the public /eliminar-datos
// page, after confirming identity with a sign-in code. Each module erases its own data in
// one transaction. While a phone of the account is still enrolled and may hold scans to
// upload, erasure answers 409 device_enrolled: no recorded operation may be lost (I6).

import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { userActor } from "../auth.ts";

export const accountRoutes = new Hono<AppEnv>().delete("/", async (c) => {
  await c.var.db.transaction(await userActor(c, "staff"), async (tx) => {
    await tx`SELECT staff.release_user_devices()`;
    await tx`SELECT identity.erase_user()`;
  });
  return c.body(null, 204);
});
