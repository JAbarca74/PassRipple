# Database

PostgreSQL. Production runs on Neon; `compose.yaml` here is for local development and CI only.

- `bootstrap/` — idempotent SQL applied before migrations: the migrations record, the API role, module roles, the `app` schema and defaults.
- `tests/` — pgTAP tests for the bootstrap, module roles and Row Level Security.
- Each module keeps its own SQL in `modules/<name>/db/migrations` and `modules/<name>/db/tests`.

## Rules

- Each module owns one schema and is its only writer (rule R1).
- Migrations are immutable once applied. To change something, write a new migration.
- Invariants live here, as constraints, triggers and policies, and every invariant has a pgTAP test that tries to break it.
- Migrations are applied in module dependency order, so a module can reference the schemas it depends on.

## Roles

| Role | What it is |
|---|---|
| `passripple_owner_<schema>` | Owns one module's schema and everything in it. Cannot log in. Reads only the schemas of the modules its `package.json` depends on. |
| `passripple_api` | The role the API connects with. Cannot bypass Row Level Security, inherits nothing, owns nothing and is a member of no role. |

`pnpm db:migrate` prepares each module's role before its migrations (`migrations.prepare_module`), then runs every migration as that role. A migration that creates objects in another schema, or reads a schema its module does not depend on, fails when it is applied. Read access is synced on every run, so removing a dependency from `package.json` also revokes it.

The runner's own session is a superuser, so this catches mistakes, not malice: migrations are reviewed code.

## Session actor

The API sets three transaction-local settings at the start of every transaction, and policies read them through the `app` schema:

| Setting | Function | Value |
|---|---|---|
| `app.actor_id` | `app.actor_id()` | uuid of the signed-in user; absent for buyers, who have no account |
| `app.actor_role` | `app.actor_role()` | `buyer`, `organizer`, `staff`, `inspector`, `admin` or `system` |
| `app.org_id` | `app.org_id()` | the organization the request acts for |

An unset setting reads as NULL, so a policy comparing against it matches nothing. A malformed value raises an error. These settings protect against a query that forgets a filter, not against a compromised API: the API is trusted to set them from an authenticated session.

## Writing a module table

- `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on every table, with policies `TO passripple_api` (and to the owner role where its functions need them). Index the columns the policies filter on (`org_id`, `event_id`).
- Grant `passripple_api` only what it needs. Tables that hold an invariant get no direct `INSERT`, `UPDATE` or `DELETE`: the API calls the module's functions.
- `SECURITY DEFINER` functions pin their search path (`SET search_path = pg_catalog`, objects schema-qualified). Functions are not executable by `PUBLIC`: grant `EXECUTE` explicitly.
- Views use `WITH (security_invoker = true)`.
- Append-only tables attach `app.reject_mutation()` as a `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger.

`db/tests/0001_module_roles.test.sql` checks these rules over every module schema, so a migration that breaks one fails `pnpm db:test`.

## Commands

```bash
pnpm db:up        # start the local database (Docker)
pnpm db:migrate   # apply bootstrap and pending migrations
pnpm db:test      # run every pgTAP test
pnpm db:down      # stop it and delete its data
```

`DATABASE_URL` overrides the target database.
