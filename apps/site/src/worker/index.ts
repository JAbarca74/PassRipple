// Entry point of the site's Worker (wrangler.jsonc "main"). The logic is in handler.ts.
import { handle, type SiteEnv } from "./handler.ts";

export default {
  fetch: (request: Request, env: SiteEnv) => handle(request, env),
};
