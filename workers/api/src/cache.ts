// Read cache at the edge for public GET routes (design 9.3, points 1 and 2). During a big
// on-sale thousands of buyers reload the same event page: the answer comes from Cloudflare's
// cache in the data center instead of a database query per visitor. Holding a ticket never
// goes through here, so the exact availability is still decided only when reserving.

import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./app.ts";
import { waitUntil } from "./wait-until.ts";

/** The part of the Workers Cache API used here (`caches.default` satisfies it). */
export interface ResponseCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** Header telling whether an answer came from the cache, for load tests and debugging. */
export const CACHE_STATUS_HEADER = "X-Edge-Cache";

/**
 * Headers that depend on who asks, not on what is asked: never stored. CORS is added again
 * per request by its own middleware, and the server's clock by the app.
 */
const PER_REQUEST_HEADERS = /^(access-control-|vary$|x-server-time$|x-edge-cache$)/i;

/**
 * Caches 200 answers marked `Cache-Control: public` under their URL, for as long as that
 * header's max-age says (the Cache API honors it). The handler decides the lifetime: 5 s for
 * an event on sale, 300 s for the public listing. Without a cache (tests, other runtimes)
 * it does nothing.
 */
export function edgeCache(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const cache = c.var.cache;
    if (!cache || c.req.method !== "GET") return next();

    const key = new Request(c.req.url, { method: "GET" });
    const hit = await cache.match(key);
    if (hit) {
      const response = new Response(hit.body, hit);
      response.headers.set(CACHE_STATUS_HEADER, "HIT");
      return response;
    }

    await next();
    const cacheControl = c.res.headers.get("Cache-Control") ?? "";
    if (c.res.status !== 200 || !/\bpublic\b/.test(cacheControl)) return;

    const stored = new Response(c.res.clone().body, c.res);
    for (const name of [...stored.headers.keys()]) {
      if (PER_REQUEST_HEADERS.test(name)) stored.headers.delete(name);
    }
    waitUntil(c, cache.put(key, stored));
    c.res.headers.set(CACHE_STATUS_HEADER, "MISS");
  };
}
