// Sign-in with a one-time code sent by email (design 3.2). Staff, organizers and inspectors
// sign in this way; buyers have no account. Asking for a code always answers the same way,
// whether or not the address has an account.

import { signInRequest, verifySignInRequest } from "@passripple/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { bearer } from "../auth.ts";
import { SYSTEM_ACTOR } from "../db.ts";
import { required } from "../env.ts";
import { ApiError } from "../errors.ts";
import {
  newSignInCode,
  newToken,
  signInCodeHash,
  tokenHash,
  USER_TOKEN_PREFIX,
} from "../secrets.ts";
import { isoRequired, jsonBody } from "../validation.ts";

const CODE_TTL_SECONDS = 600;
const SESSION_TTL_HOURS = 24;

export const authRoutes = new Hono<AppEnv>()
  .post("/sign-in", async (c) => {
    const { email } = await jsonBody(c, signInRequest);
    const code = newSignInCode();
    const hash = await signInCodeHash(required(c.env, "SIGN_IN_PEPPER"), email, code);
    await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      await tx`SELECT identity.request_sign_in(${email}, ${hash}, make_interval(secs => ${CODE_TTL_SECONDS}))`;
    });
    await c.var.mailer().send({
      to: email,
      subject: "Su código de PassRipple",
      text: [
        `Su código para entrar a PassRipple es ${code}.`,
        "Vence en 10 minutos. No lo comparta con nadie.",
        "Si usted no lo pidió, ignore este correo.",
      ].join("\n\n"),
    });
    return c.json({ expiresInSeconds: CODE_TTL_SECONDS }, 202);
  })

  .post("/verify", async (c) => {
    const { email, code } = await jsonBody(c, verifySignInRequest);
    const hash = await signInCodeHash(required(c.env, "SIGN_IN_PEPPER"), email, code);
    const token = newToken(USER_TOKEN_PREFIX);
    const session = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      const [row] = await tx<{ user_id: string | null; expires_at: Date }[]>`
        SELECT identity.verify_sign_in(${email}, ${hash}, ${await tokenHash(token)},
                                       make_interval(hours => ${SESSION_TTL_HOURS})) AS user_id,
               now() + make_interval(hours => ${SESSION_TTL_HOURS}) AS expires_at`;
      return row;
    });
    if (!session?.user_id) {
      throw new ApiError(401, "invalid_code", "The code is wrong, used or expired.");
    }
    return c.json({ token, userId: session.user_id, expiresAt: isoRequired(session.expires_at) });
  })

  .post("/sign-out", async (c) => {
    const hash = await tokenHash(bearer(c, USER_TOKEN_PREFIX));
    await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      await tx`SELECT identity.end_session(${hash})`;
    });
    return c.body(null, 204);
  });
