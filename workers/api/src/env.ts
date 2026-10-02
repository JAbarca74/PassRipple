// What the API Worker receives from Cloudflare: the bindings and variables declared in
// wrangler.jsonc, and the secrets set with `wrangler secret put` (`.dev.vars` locally, from
// `.dev.vars.example`). Nothing here is read from process.env.

export interface Env {
  /** Pooled connection to PostgreSQL as passripple_api, through Cloudflare Hyperdrive. */
  readonly HYPERDRIVE: Hyperdrive;

  /**
   * Key of the HMAC that hashes sign-in codes and staff codes before they reach the
   * database: 32 or more random bytes, base64. Secret.
   */
  readonly SIGN_IN_PEPPER?: string;

  /**
   * The server's public key ring, as JSON: `[{"id":1,"publicKey":"<base64url>"}]`. Public,
   * not secret: gate devices receive it in every manifest. Only keys still valid belong
   * here; retiring a key means removing it (ADR 0014).
   */
  readonly SERVER_PUBLIC_KEYS?: string;

  /** `ses` in production. `log` prints messages to the console, and only works on localhost. */
  readonly MAIL_PROVIDER?: string;
  readonly MAIL_FROM_ADDRESS?: string;
  readonly MAIL_FROM_NAME?: string;
  /** Amazon SES. The access key is secret. */
  readonly SES_REGION?: string;
  readonly SES_ACCESS_KEY_ID?: string;
  readonly SES_SECRET_ACCESS_KEY?: string;
}

/** A required setting, or a configuration error that fails the request. */
export function required(env: Env, name: keyof Omit<Env, "HYPERDRIVE">): string {
  const value = env[name];
  if (!value) throw new Error(`missing Worker setting ${name}`);
  return value;
}
