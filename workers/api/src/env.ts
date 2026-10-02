// What the API Worker receives from Cloudflare: the bindings and variables declared in
// wrangler.jsonc, and the secrets set with `wrangler secret put` (`.dev.vars` locally).
// Nothing here is read from process.env.

export interface Env {
  /** Pooled connection to PostgreSQL as passripple_api, through Cloudflare Hyperdrive. */
  readonly HYPERDRIVE: Hyperdrive;
}
