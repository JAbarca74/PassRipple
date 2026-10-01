# Application

Single-page application served on `app.<domain>`: three-tap checkout, the buyer wallet, the organizer dashboard, the municipal portal and administration.

- Built with Vite, React and Tailwind. It becomes an installable PWA in Phase 3.
- No third-party scripts and a strict Content Security Policy (invariant I8), set in [`public/_headers`](public/_headers).

**Status:** basic interfaces on static demonstration data ([`src/demo.ts`](src/demo.ts)). Nothing calls the API yet.

```bash
pnpm dev:app    # http://localhost:5174, the root lists every screen
```

| Path | Screen |
|---|---|
| `/comprar`, `/pagar`, `/espera` | Checkout, SINPE payment, waiting room |
| `/entradas`, `/entradas/abierta` | Wallet and an open ticket |
| `/transferir`, `/recuperar`, `/asignar`, `/mis-datos` | Transfer, recovery, named attendee, the buyer's data |
| `/organizador`, `/organizador/crear`, `/organizador/staff`, `/organizador/liquidacion` | Organizer dashboard, new event, staff, payout |
| `/admin` | Administration |
| `/municipalidad` | Municipal portal |

`VITE_SITE_URL` sets the public site origin used for the legal links (default `http://localhost:5173`).

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
