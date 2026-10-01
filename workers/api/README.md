# API

HTTP API on Cloudflare Workers: checkout, wallet, dashboard, gate manifests and offline batches. It is the composition root that wires modules together.

- Connects to Neon through Hyperdrive.
- Sets the acting user on every database transaction so Row Level Security applies.

**Status:** placeholder. Scaffolded in Phase 0.

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
