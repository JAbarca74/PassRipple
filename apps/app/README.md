# Application

Single-page application served on `app.<domain>`: three-tap checkout, the buyer wallet, the organizer dashboard, the municipal portal and administration.

- Built with Vite, React and Tailwind.
- No third-party scripts and a strict Content Security Policy (invariant I8), set in [`public/_headers`](public/_headers). `connect-src` allows this origin and the API's, which the build writes from `VITE_API_URL` in place of `__API_ORIGIN__` (`vite.config.ts`).

**Status:** checkout and wallet run on the API (Phase 3). Transfer, named attendees, the buyer's data screen, the waiting room, the organizer dashboard, administration and the municipal portal still show static demonstration data ([`src/demo.ts`](src/demo.ts)).

```bash
pnpm dev:app    # http://localhost:5174, the root lists every screen
```

Locally it calls `wrangler dev` on `http://localhost:8787` (`VITE_API_URL`) with the development event of `pnpm dev:fixtures seed`: `http://localhost:5174/comprar?evento=evento-de-desarrollo`.

## Three taps (design 2.8, 10.1)

From the event's link to the ticket on the phone, counted on the real screens:

| Tap | Where | What happens |
|---|---|---|
| 1 | "Comprar" on the event's page (site) | Opens `/comprar?evento=<slug>` with the first type and quantity 1 selected. The device key is created now (ADR 0032) |
| 2 | The "Correo o teléfono" field | One field, no account |
| 3 | "Aceptar y pagar con SINPE" | Accepts the terms and privacy policy shown right above it, holds the tickets and shows the payment data |
| — | Payment in the bank's app | Outside the app |
| — | Back to the app | The payment screen polls; when the order is paid it binds the tickets to this device and opens the wallet, with no tap |

Changing a type or the quantity is optional and does not count. Anything that adds a tap needs an ADR.

## Buyer's device key and tokens

- One Ed25519 key per device, non-extractable, kept in IndexedDB (`src/lib/device-key.ts`, ADR 0032). The browser needs Ed25519 in WebCrypto: Safari 17, Chrome 137, Firefox 129 or later.
- Orders this device holds, with their access tokens, in `localStorage` (`src/lib/orders.ts`). The token travels only as `Authorization: Bearer`.
- The QR is signed again for every 30-second window with the device key (`presentCredential`), by the server's clock (`X-Server-Time`). Without a ticket id, `/entradas/abierta?orden=…` shows every ticket of the order held here, one per second (burst mode, 6.5).
- Recovery on a new phone: `/recuperar` (ADR 0036). Erasure: `/eliminar-datos` on the site (ADR 0037).

| Path | Screen |
|---|---|
| `/comprar?evento=<slug>`, `/pagar?orden=<code>`, `/espera` | Checkout, SINPE payment, waiting room |
| `/entradas`, `/entradas/abierta?orden=<code>[&entrada=<id>]` | Wallet and an open ticket |
| `/transferir`, `/recuperar`, `/asignar`, `/mis-datos` | Transfer, recovery, named attendee, the buyer's data |
| `/organizador`, `/organizador/crear`, `/organizador/staff`, `/organizador/liquidacion` | Organizer dashboard, new event, staff, payout |
| `/admin` | Administration |
| `/municipalidad` | Municipal portal |

`VITE_SITE_URL` sets the public site origin used for the legal links (default `http://localhost:5173`).

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
