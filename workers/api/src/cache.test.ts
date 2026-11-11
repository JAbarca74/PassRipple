import { Hono } from "hono";
import { cors } from "hono/cors";
import { describe, expect, test, vi } from "vitest";
import { type AppEnv, createApp, SERVER_TIME_HEADER, type Services } from "./app.ts";
import { CACHE_STATUS_HEADER, edgeCache, type ResponseCache } from "./cache.ts";
import type { Database } from "./db.ts";

/** An in-memory stand-in for caches.default: keyed by URL, ignores expiry. */
function fakeCache() {
  const stored = new Map<string, Response>();
  const cache: ResponseCache = {
    match: vi.fn(async (request: Request) => stored.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      stored.set(request.url, response);
    }),
  };
  return { cache, stored };
}

function appWith(cache: ResponseCache | null, cacheControl = "public, max-age=5", status = 200) {
  const handler = vi.fn();
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set("cache", cache);
    await next();
  });
  app.use(cors({ origin: (origin) => origin }));
  app.use(edgeCache());
  app.on(["GET", "POST"], "/events/:slug", (c) => {
    handler();
    c.header("Cache-Control", cacheControl);
    return c.json({ slug: c.req.param("slug") }, status as 200);
  });
  return { app, handler };
}

describe("edgeCache", () => {
  test("serves the second read from the cache without running the handler", async () => {
    const { cache } = fakeCache();
    const { app, handler } = appWith(cache);

    const first = await app.request("http://api.test/events/fiesta");
    expect(first.headers.get(CACHE_STATUS_HEADER)).toBe("MISS");
    expect(await first.json()).toEqual({ slug: "fiesta" });

    const second = await app.request("http://api.test/events/fiesta");
    expect(second.status).toBe(200);
    expect(second.headers.get(CACHE_STATUS_HEADER)).toBe("HIT");
    expect(await second.json()).toEqual({ slug: "fiesta" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("keys by URL: another event or another query is a miss", async () => {
    const { cache } = fakeCache();
    const { app, handler } = appWith(cache);
    await app.request("http://api.test/events/fiesta");
    await app.request("http://api.test/events/otra");
    await app.request("http://api.test/events/fiesta?x=1");
    expect(handler).toHaveBeenCalledTimes(3);
  });

  test("never stores per-request headers, and CORS is added again on a hit", async () => {
    const { cache, stored } = fakeCache();
    const { app } = appWith(cache);
    const origin = { Origin: "https://app.test" };
    await app.request("http://api.test/events/fiesta", { headers: origin });

    const saved = stored.get("http://api.test/events/fiesta");
    expect(saved?.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(saved?.headers.get("Vary")).toBeNull();
    expect(saved?.headers.get(CACHE_STATUS_HEADER)).toBeNull();
    expect(saved?.headers.get("Cache-Control")).toBe("public, max-age=5");

    const hit = await app.request("http://api.test/events/fiesta", {
      headers: { Origin: "https://other.test" },
    });
    expect(hit.headers.get(CACHE_STATUS_HEADER)).toBe("HIT");
    expect(hit.headers.get("Access-Control-Allow-Origin")).toBe("https://other.test");
  });

  test("does not store private answers or errors", async () => {
    for (const [cacheControl, status] of [
      ["private, max-age=5", 200],
      ["no-store", 200],
      ["public, max-age=5", 404],
    ] as const) {
      const { cache } = fakeCache();
      const { app, handler } = appWith(cache, cacheControl, status);
      await app.request("http://api.test/events/fiesta");
      await app.request("http://api.test/events/fiesta");
      expect(handler).toHaveBeenCalledTimes(2);
      expect(cache.put).not.toHaveBeenCalled();
    }
  });

  test("lets writes and runs without a cache pass through", async () => {
    const { cache } = fakeCache();
    const writes = appWith(cache);
    await writes.app.request("http://api.test/events/fiesta", { method: "POST" });
    await writes.app.request("http://api.test/events/fiesta", { method: "POST" });
    expect(writes.handler).toHaveBeenCalledTimes(2);
    expect(cache.match).not.toHaveBeenCalled();

    const bare = appWith(null);
    const response = await bare.app.request("http://api.test/events/fiesta");
    expect(response.headers.get(CACHE_STATUS_HEADER)).toBeNull();
  });
});

describe("edge cache in the app", () => {
  function services(cache: ResponseCache) {
    const transaction = vi.fn(async () => []);
    const svc: Services = {
      database: () =>
        ({ transaction, close: vi.fn().mockResolvedValue(undefined) }) as unknown as Database,
      mailer: () => ({}) as unknown as ReturnType<Services["mailer"]>,
      integrity: () => ({}) as unknown as ReturnType<Services["integrity"]>,
      cache: () => cache,
    };
    return { svc, transaction };
  }

  test("the public listing queries the database once per cache lifetime", async () => {
    const { cache } = fakeCache();
    const { svc, transaction } = services(cache);
    const app = createApp(svc);

    const env = { APP_ORIGINS: "" } as never;
    const first = await app.request("http://api.test/v1/events", {}, env);
    const second = await app.request("http://api.test/v1/events", {}, env);
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(second.headers.get(CACHE_STATUS_HEADER)).toBe("HIT");
    expect(second.headers.get(SERVER_TIME_HEADER)).not.toBeNull();
    expect(await second.json()).toEqual({ events: [] });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  test("an error on the event page is not cached", async () => {
    const { cache } = fakeCache();
    const { svc } = services(cache);
    const app = createApp(svc);
    // No FEE_SCHEDULE: the event page answers 503 not_configured.
    const env = { APP_ORIGINS: "" } as never;
    const first = await app.request("http://api.test/v1/events/fiesta", {}, env);
    const second = await app.request("http://api.test/v1/events/fiesta", {}, env);
    expect(first.status).toBe(503);
    expect(second.headers.get(CACHE_STATUS_HEADER)).toBeNull();
    expect(cache.put).not.toHaveBeenCalled();
  });
});
