# @passripple/outbox

**Kind:** core · **Level:** 0 (core)

## Responsibility

Durable on-device queue (design 8.6 to 8.8): enqueue operations and drain them in batches through an injected `Transport`, so nothing a gate device records is lost (invariant I6).

## How it works

- **FIFO by device sequence number**, never by wall clock. The store assigns the number when it appends, in the same transaction.
- **States:** `pending → sending → acked`. A failed send puts the batch back in `pending` with one more attempt; an operation the server rejects goes to `quarantined`, which should never happen (8.5) and is kept for a person to review. Nothing is ever dropped.
- **Batches** of 50 by default (at most 100). The server answers per operation (`applied`, `duplicate`, `rejected`); an operation with no result goes back to `pending`.
- **Each send gives up after 4 seconds** (the transport enforces `timeoutMs`).
- **Backoff:** after a failure, exponential from 2 seconds up to a minute, with equal jitter so devices that failed together spread out.
- **Circuit breaker:** after 3 failures in a row it opens for 60 seconds, then probes with a single operation; success closes it.
- `drain()` sends batch after batch until nothing is pending; overlapping calls return `busy`. When to drain (every two minutes, on resume, when signal returns) is the caller's decision.
- `recover()` puts back entries a crash left in `sending`. Call it once at start-up.

## Ports

Everything with an effect is injected, so the package does no I/O, reads no clock and draws no randomness (rule R4):

| Port | What it does |
|---|---|
| `OutboxStore<P, Tx>` | Durable storage. Each call must be durable when it resolves (SQLite with WAL and `synchronous = FULL` on the device). `Tx` is the store's transaction handle, passed through `enqueue`, so a scan and its operation are recorded in one transaction |
| `Transport<P>` | Sends one batch and returns one result per operation; throws when the batch did not get through |
| `Clock` | `now()` in milliseconds |
| `Random` | `next()` in [0, 1), for the jitter |

## Depends on

- `@passripple/contracts`

## Guarantees

- Invariant I6 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Know what a redemption, a sale or a courtesy is. Payloads are opaque. Generate ids: the caller passes a UUIDv7 (`uuidv7` in `@passripple/contracts`).

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.

| Export | What it does |
|---|---|
| `createOutbox({ store, transport, clock, random, config })` | The queue: `enqueue`, `drain`, `recover`, `status` |
| `DEFAULT_CONFIG` | Batch size 50, timeout 4 s, circuit after 3 failures for 60 s, backoff 2 s to 60 s |
| Types | `OutboxStore`, `Transport`, `Clock`, `Random`, `OutboxEntry`, `NewOperation`, `ItemResult`, `DrainReport`, `OutboxStatus` and the rest |
