# Database

PostgreSQL. Production runs on Neon; `compose.yaml` here is for local development and CI only.

- `bootstrap/` — idempotent SQL applied before migrations: the migrations table, base roles and defaults.
- `tests/` — pgTAP tests for the bootstrap.
- Each module keeps its own SQL in `modules/<name>/db/migrations` and `modules/<name>/db/tests`.

## Rules

- Each module owns one schema and is its only writer (rule R1).
- Migrations are immutable once applied. To change something, write a new migration.
- Invariants live here, as constraints, triggers and policies, and every invariant has a pgTAP test that tries to break it.
- Migrations are applied in module dependency order, so a module can reference the schemas it depends on.

## Commands

```bash
pnpm db:up        # start the local database (Docker)
pnpm db:migrate   # apply bootstrap and pending migrations
pnpm db:test      # run every pgTAP test
pnpm db:down      # stop it and delete its data
```

`DATABASE_URL` overrides the target database.
