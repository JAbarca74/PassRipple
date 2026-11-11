import type { SeoEvent } from "@passripple/contracts";
import { afterEach, describe, expect, test, vi } from "vitest";
import { handle, injectHead, isFullSite, type SiteEnv } from "./handler.ts";

const FULL = `<!doctype html><html><head><meta charset="UTF-8" />
<meta name="description" content="Genérica" />
<title>PassRipple · Entradas que no se pueden copiar</title>
</head><body><div id="root"></div></body></html>`;
const HOLDING = "<!doctype html><html><head><title>Próximamente</title></head><body></body></html>";

const event: SeoEvent = {
  slug: "motocross-pz",
  name: "Motocross",
  venueName: "Finca El Llano",
  locality: "Pérez Zeledón",
  organizerName: "Asociación",
  startsAt: "2026-11-15T19:00:00.000Z",
  endsAt: "2026-11-16T01:00:00.000Z",
  status: "on_sale",
  ageRating: "all",
  fromPriceCrc: 5000,
  publishedAt: "2026-11-01T15:00:00.000Z",
};

function env(index: string): SiteEnv & { assets: string[] } {
  const assets: string[] = [];
  return {
    assets,
    API_ORIGIN: "https://api.test",
    SITE_ORIGIN: "https://site.test",
    APP_ORIGIN: "https://app.test",
    ASSETS: {
      fetch: async (request) => {
        const path = new URL(typeof request === "string" ? request : request.url).pathname;
        assets.push(path);
        if (path === "/") return new Response(index, { headers: { "x-from": "assets" } });
        if (path === "/404.html") return new Response("no existe", { status: 404 });
        return new Response(`asset ${path}`);
      },
    },
  };
}

function api(events: SeoEvent[] | "fail") {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: URL) => {
    calls.push(url.toString());
    if (events === "fail") return new Response("down", { status: 503 });
    const slug = url.searchParams.get("slug");
    return Response.json({ events: slug ? events.filter((e) => e.slug === slug) : events });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("site worker", () => {
  test("isFullSite and injectHead", () => {
    expect(isFullSite(FULL)).toBe(true);
    expect(isFullSite(HOLDING)).toBe(false);
    const html = injectHead(FULL, `A & "B"`, "<meta name=x>");
    expect(html).toContain("<title>A &amp; &quot;B&quot;</title>");
    expect(html).not.toContain("Genérica");
    expect(html).toContain("<meta name=x>\n</head>");
  });

  test("the site's own pages get the full site's index.html", async () => {
    api([event]);
    const response = await handle(new Request("https://site.test/privacidad"), env(FULL));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(FULL);
  });

  test("other paths are plain static assets", async () => {
    const calls = api([event]);
    const site = env(FULL);
    const response = await handle(new Request("https://site.test/og-image.png"), site);
    expect(await response.text()).toBe("asset /og-image.png");
    expect(calls).toHaveLength(0);
  });

  test("an event page carries the event's head", async () => {
    const calls = api([event]);
    const response = await handle(new Request("https://site.test/eventos/motocross-pz"), env(FULL));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("x-from")).toBe("assets");
    expect(html).toContain("<title>Motocross · 15 nov · Finca El Llano — Entradas</title>");
    expect(html).toContain('"@type":"Event"');
    expect(html).toContain('content="https://site.test/og-image.png"');
    expect(html).toContain(
      '<script type="application/json" id="event-data">{"slug":"motocross-pz"',
    );
    expect(calls).toEqual(["https://api.test/v1/events?slug=motocross-pz"]);
  });

  test("an unknown event is a 404 page", async () => {
    api([event]);
    const response = await handle(new Request("https://site.test/eventos/no-existe"), env(FULL));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("no existe");
  });

  test("an API failure on an event page is also a 404, never a broken page", async () => {
    api("fail");
    const response = await handle(new Request("https://site.test/eventos/motocross-pz"), env(FULL));
    expect(response.status).toBe(404);
  });

  test("sitemap.xml lists the fixed pages and the events", async () => {
    api([event]);
    const response = await handle(new Request("https://site.test/sitemap.xml"), env(FULL));
    const xml = await response.text();
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain("<loc>https://site.test/terminos</loc>");
    expect(xml).toContain("<loc>https://site.test/eventos/motocross-pz</loc>");
  });

  test("sitemap.xml falls back to the static file when the API fails", async () => {
    api("fail");
    const response = await handle(new Request("https://site.test/sitemap.xml"), env(FULL));
    expect(await response.text()).toBe("asset /sitemap.xml");
  });

  test("in coming-soon mode both paths are left to the static assets", async () => {
    const calls = api([event]);
    const site = env(HOLDING);
    expect(await (await handle(new Request("https://site.test/sitemap.xml"), site)).text()).toBe(
      "asset /sitemap.xml",
    );
    expect(
      await (await handle(new Request("https://site.test/eventos/motocross-pz"), site)).text(),
    ).toBe("asset /eventos/motocross-pz");
    expect(calls).toHaveLength(0);
  });
});
