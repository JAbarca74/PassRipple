# LAN coordinator

Optional local server that deduplicates redemptions across gates without internet, for events with many gates in the same zone.

- Single binary that an organizer runs on a laptop.

**Status:** core built in Phase 9 (claims store, HTTP routes, Node server). Run with `COORDINATOR_TOKEN=<16+ chars> node src/main.ts`. The gate app calls it through `apps/scanner/src/lib/coordinator.ts`; wiring that call into the gate screen still needs two phones on a real LAN.

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
