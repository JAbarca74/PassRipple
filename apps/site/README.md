# Public site

Templates for the public site: home, event pages, organizer pages and legal pages. Event pages get their head (title, Open Graph, schema.org Event) and their data from the site's Worker at request time (ADR 0040).

- Analytics run here only, and only after consent. The cookie banner stores the choice; no analytics is loaded yet.
- Built with Vite, React and Tailwind. Pages use plain links, as the pre-rendered site will.

**Status:** event pages and `sitemap.xml` run on real data through the Worker (Phase 5). Home and organizer pages still show static demonstration data ([`src/data.ts`](src/data.ts)); in production the demonstration events never appear.

## Worker (ADR 0040)

[`src/worker/handler.ts`](src/worker/handler.ts) runs only for `/eventos/*`, `/sitemap.xml`, `/privacidad`, `/terminos` and `/eliminar-datos` (`run_worker_first` in [`wrangler.jsonc`](wrangler.jsonc)); everything else is a static asset.

- `/eventos/<slug>`: `index.html` with the event's title, description, canonical link, Open Graph, JSON-LD and the event as JSON (`#event-data`, read by [`src/event-data.ts`](src/event-data.ts)), from `GET /v1/events?slug=`. Unknown events get `404.html` with status 404.
- `/sitemap.xml`: `/`, `/privacidad`, `/terminos` and every listed event; falls back to the static file if the API fails.
- The legal pages: the full site's `index.html`.
- In coming-soon mode it hands every path back to the static assets.

To try it locally against `wrangler dev` of the API: build the full site (`pnpm build`), then start `site-worker-local` from `.claude/launch.json` (port 8789).

```bash
pnpm dev:site   # http://localhost:5173
```

| Path | Page |
|---|---|
| `/` | Home |
| `/eventos/<slug>` | Event page; `?estado=sold-out` or `?estado=cancelled` previews those variants |
| `/organizadores/<slug>` | Organizer page |
| `/privacidad`, `/terminos` | Legal documents. The privacy policy covers the gate app's staff (data, providers, retention, deletion); the rest is pending legal review |
| `/eliminar-datos` | Account deletion for staff, organizers and inspectors: email, code, done. Calls the API (`VITE_API_URL`), whose origin joins the CSP's `connect-src` at build time |

`VITE_APP_URL` sets the app origin that the "Comprar" button opens (default `http://localhost:5174`). The variables are listed in [`.env.example`](.env.example); copy it to `.env`.

## Coming-soon mode

While the platform is being built, the deployed site is a single holding page, [`coming-soon.html`](coming-soon.html). The `coming-soon` mode builds that page as `dist/index.html`, plus [`404.html`](404.html), which the static assets serve with status 404 for every path that is not a file. `/privacidad`, `/terminos` and `/eliminar-datos`, which Google Play links to, are built into `dist/site.html`, and `_redirects` rewrites them to `/site`, not `/site.html`: the static assets redirect `/site.html` to `/site`, which would take the visitor away from the legal page's own address. Its styles and script are bundled files, so the same `_headers` CSP applies. [`robots.txt`](public/robots.txt), [`sitemap.xml`](public/sitemap.xml) and the Organization data in the page help search engines; the steps in Google Search Console are outside the repository.

```bash
pnpm dev:coming-soon     # http://localhost:5173
pnpm build:coming-soon   # apps/site/dist, ready to deploy
```

To publish the full site, build it with `pnpm build` instead and deploy the same way.

## Deploy

The site is a Cloudflare Worker with static assets and the small script above: [`wrangler.jsonc`](wrangler.jsonc) serves `dist/` on `passripple.com` and `www.passripple.com`. Build locally, check with a dry run that the upload lists only the expected files and only the `ASSETS` binding and the three origin variables, then deploy. Always pass `--config`: Wrangler otherwise uses the configuration of the directory it runs in, and `workers/api` holds the API's.

```bash
pnpm build:coming-soon
pnpm --filter @passripple/worker-api exec wrangler deploy --config ../../apps/site/wrangler.jsonc --dry-run
pnpm --filter @passripple/worker-api exec wrangler deploy --config ../../apps/site/wrangler.jsonc
```

The redirect from `www` to the apex is a Cloudflare redirect rule, outside the repository.

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
