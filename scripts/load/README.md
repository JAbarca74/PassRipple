# Load tests (design 9.8)

k6 scripts for the acceptance criteria of Phase 6. They run against a **throwaway database
or a Neon test branch, never production**: they create fictitious events, orders and gate
scans marked "load".

| Script | Criterion |
|---|---|
| `purchase.js` | 5,000 buyers at once for the 10,000 seats of `carga-a`: zero overselling, zero duplicate orders, hold p95 under 1 s. `carga-b` sells at a steady pace meanwhile: its hold p95 must stay under 1 s (isolation). |
| `gate.js` | 100 gate devices uploading batches at once: every operation comes back `applied` or `duplicate` (I6). |
| `seed.sql` | The data both need: three events, 5,000 gate tickets, 100 gate devices with known tokens. Idempotent. |
| `verify.sql` | Read-only checks after a run. Every row must say `ok = t`. |

## Order

1. Migrate the database (`node scripts/db.ts migrate`) and seed it as its owner:
   `psql "$DATABASE_URL" -f scripts/load/seed.sql`.
2. Point an API at that database with a `FEE_SCHEDULE`, `SINPE_NUMBER` and `SIGN_IN_PEPPER`.
3. Run the scripts, then `psql "$DATABASE_URL" -f scripts/load/verify.sql`.

To run `purchase.js` again, seed a fresh database: the 10,000 seats stay held for 30
minutes (or sold), and a second run would only measure "sold out" answers.

## Locally, small

Checks that the scripts work, not the criteria: one laptop, `wrangler dev` and a local
PostgreSQL are not the production stack. With the `api-dev` server running (port 8787,
database on 55433, see `.claude/launch.json`):

```bash
docker run --rm -i -v "$PWD/scripts/load:/load" grafana/k6:2.3.0 run \
  -e API=http://host.docker.internal:8787/v1 -e BUYERS=200 -e DURATION=1m /load/purchase.js
docker run --rm -i -v "$PWD/scripts/load:/load" grafana/k6:2.3.0 run \
  -e API=http://host.docker.internal:8787/v1 -e DEVICES=20 -e BATCHES=3 /load/gate.js
```

Local runs hit the API's per-IP limits (if any) and the laptop's limits long before 5,000
buyers. Use `-e BUYERS=0` for a baseline of `carga-b` alone.

## For real

1. Create a Neon branch from `dev` (for example `load-<date>`), migrate it and seed it.
2. Deploy the API to a separate Worker (for example `passripple-api-load`) whose Hyperdrive
   points to that branch, with caching off. Never reuse the production Worker.
3. Run from a machine or k6 Cloud close to Cloudflare, with the full numbers:
   `k6 run -e API=https://<load worker>/v1 -e BUYERS=5000 scripts/load/purchase.js`, then
   `gate.js` with the defaults, then `verify.sql`.
4. Delete the Worker and the branch.

Thresholds fail the run on their own: hold p95 under 1 s on both events, zero unexpected
answers, zero duplicate orders, zero lost gate operations.
