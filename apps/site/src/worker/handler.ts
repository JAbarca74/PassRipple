// The site's Worker (ADR 0040): everything is a static asset except two paths, which it
// renders from the API's public listing so that search engines and link previews, which do
// not run JavaScript, see real content:
//   /eventos/<slug>  the site's page with the event's title, description, Open Graph tags
//                    and schema.org Event injected into <head>; 404 when no such event
//   /sitemap.xml     the fixed pages plus every listed event
// While the site is in coming-soon mode (index.html is the holding page) both fall through
// to the static assets, so nothing but the holding and legal pages is public.

import type { SeoEvent, SeoEventsResponse } from "@passripple/contracts";
import {
  escapeHtml,
  eventHeadTags,
  eventTitle,
  type SiteOrigins,
  sitemapXml,
} from "@passripple/seo";
import { EVENT_DATA_ID } from "../event-data.ts";

export interface SiteEnv {
  readonly ASSETS: { fetch(request: Request | string): Promise<Response> };
  /** https://api.passripple.com */
  readonly API_ORIGIN: string;
  /** https://passripple.com */
  readonly SITE_ORIGIN: string;
  /** https://app.passripple.com */
  readonly APP_ORIGIN: string;
}

/** Pages of the full site that the sitemap always lists. */
export const FIXED_PATHS = ["/", "/privacidad", "/terminos"] as const;
/** Client-side pages of the full site besides "/", served with its index.html. */
export const PAGE_PATHS = ["/privacidad", "/terminos", "/eliminar-datos"] as const;
const EVENT_PATH = /^\/eventos\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;
/** Edge and browser cache: the listing changes when an organizer publishes or edits. */
const CACHE = "public, max-age=300";

/** True when index.html is the full site (the React root), not the holding page. */
export function isFullSite(indexHtml: string): boolean {
  return indexHtml.includes('<div id="root">');
}

/** Puts the event's title and tags into the site's page, replacing the generic ones. */
export function injectHead(html: string, title: string, tags: string): string {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description"[^>]*>\s*/, "")
    .replace("</head>", `${tags}\n</head>`);
}

async function listing(env: SiteEnv, slug?: string): Promise<readonly SeoEvent[] | null> {
  const url = new URL("/v1/events", env.API_ORIGIN);
  if (slug) url.searchParams.set("slug", slug);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  return ((await response.json()) as SeoEventsResponse).events;
}

export async function handle(request: Request, env: SiteEnv): Promise<Response> {
  const url = new URL(request.url);
  const event = EVENT_PATH.exec(url.pathname);
  const page = (PAGE_PATHS as readonly string[]).includes(url.pathname);
  if (!event && !page && url.pathname !== "/sitemap.xml") return env.ASSETS.fetch(request);

  const index = await env.ASSETS.fetch(new Request(new URL("/", url), request));
  const html = await index.text();
  if (!isFullSite(html)) return env.ASSETS.fetch(request);
  // The site's own pages are client-side routes of the same index.html.
  if (page) return new Response(html, { headers: index.headers });

  const origins: SiteOrigins = { site: env.SITE_ORIGIN, app: env.APP_ORIGIN };
  if (!event) {
    const events = await listing(env);
    if (events === null) return env.ASSETS.fetch(request);
    return new Response(sitemapXml(events, origins, FIXED_PATHS), {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": CACHE },
    });
  }

  const slug = event[1] as string;
  const found = (await listing(env, slug))?.[0];
  if (!found) {
    const notFound = await env.ASSETS.fetch(new Request(new URL("/404.html", url), request));
    return new Response(notFound.body, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const image = `${env.SITE_ORIGIN}/og-image.png`;
  // The page reads its event from here (event-data.ts): JSON, never executed, with "<"
  // escaped so no event text can end the element.
  const data = `<script type="application/json" id="${EVENT_DATA_ID}">${JSON.stringify(found).replaceAll("<", "\\u003c")}</script>`;
  const headers = new Headers(index.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", CACHE);
  const tags = `${eventHeadTags(found, origins, image)}
${data}`;
  return new Response(injectHead(html, eventTitle(found), tags), {
    headers,
  });
}
