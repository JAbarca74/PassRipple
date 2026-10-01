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
| `/privacidad`, `/terminos` | Legal template (text pending legal review) |
| `/eliminar-datos` | Data deletion request |

`VITE_APP_URL` sets the app origin that the "Comprar" button opens (default `http://localhost:5174`). The variables are listed in [`.env.example`](.env.example); copy it to `.env`.

## Coming-soon mode

While the platform is being built, the deployed site is a single holding page, [`coming-soon.html`](coming-soon.html). The `coming-soon` mode builds only that page, as `dist/index.html`, so every path shows it. Its styles and script are bundled files, so the same `_headers` CSP applies.

```bash
pnpm dev:coming-soon     # http://localhost:5173
pnpm build:coming-soon   # apps/site/dist, ready for Cloudflare Pages
```

Switch the Pages build command back to `pnpm build` to publish the full site.

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
