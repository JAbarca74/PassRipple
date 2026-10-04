# Public site

Templates for the public site: home, event pages, organizer pages and legal pages. Event pages are pre-rendered by the `seo` module when an event is published.

- Analytics run here only, and only after consent. The cookie banner stores the choice; no analytics is loaded yet.
- Built with Vite, React and Tailwind. Pages use plain links, as the pre-rendered site will.

**Status:** basic templates on static demonstration data ([`src/data.ts`](src/data.ts)). Pre-rendering arrives in Phase 5.

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

While the platform is being built, the deployed site is a single holding page, [`coming-soon.html`](coming-soon.html). The `coming-soon` mode builds that page as `dist/index.html`, so every path shows it, except `/privacidad`, `/terminos` and `/eliminar-datos`, which Google Play links to: they are built into `dist/site.html` and `_redirects` rewrites them there. Its styles and script are bundled files, so the same `_headers` CSP applies.

```bash
pnpm dev:coming-soon     # http://localhost:5173
pnpm build:coming-soon   # apps/site/dist, ready to deploy
```

To publish the full site, build it with `pnpm build` instead and deploy the same way.

## Deploy

The site is a Cloudflare Worker with static assets only, no script: [`wrangler.jsonc`](wrangler.jsonc) serves `dist/` on `passripple.com` and `www.passripple.com`. Build locally, check with a dry run that the upload lists only the expected files and no bindings, then deploy. Always pass `--config`: Wrangler otherwise uses the configuration of the directory it runs in, and `workers/api` holds the API's.

```bash
pnpm build:coming-soon
pnpm --filter @passripple/worker-api exec wrangler deploy --config ../../apps/site/wrangler.jsonc --dry-run
pnpm --filter @passripple/worker-api exec wrangler deploy --config ../../apps/site/wrangler.jsonc
```

The redirect from `www` to the apex is a Cloudflare redirect rule, outside the repository.

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
