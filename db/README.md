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

The runner connects as an administrative role: the superuser locally, Neon's owner role in production. On Neon that role is not a superuser, and since PostgreSQL 16 creating a role does not let its creator act as it, so `prepare_module` makes the migration role a member of each module role (`SET` to run migrations as it, `INHERIT` to grant on its objects). Either way the runner's session can leave a module role again, so this catches mistakes, not malice: migrations are reviewed code. The API role is never a member of a module role.

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

`DATABASE_URL` overrides the target database. The scripts never read it from a `.env` file, so a local command cannot reach production by accident.

## Production database (Neon)

Production runs on Neon, with a `production` branch and a `dev` branch. The API connects through Cloudflare Hyperdrive as `passripple_api`; nothing else connects to the database.

1. **Create the project** with PostgreSQL 18, the version of the local image (`db/Dockerfile`), in the region closest to the Workers. Create a `dev` branch from the default branch, `production`.
2. **Check the module roles first, on `dev`.** Neon's administrative role is not a true superuser. Migrations create one role per module and run each migration as that role (`SET ROLE`), and the bootstrap alters `passripple_api`. Run the migrations once on `dev` and confirm they apply cleanly before touching `production`.
3. **Apply the migrations**, exporting the connection only for that command:

   ```bash
   DATABASE_URL='<dev branch connection string>' pnpm db:migrate
   ```

   Then migrate `production` the same way. `pnpm db:test` runs against the local database and in CI, never against Neon: the concurrency tests open extra passwordless local connections with dblink and commit data of their own.
4. **Let the API log in.** Locally `passripple_api` cannot log in. On each Neon branch, once, by hand (never in a migration, because the password is a secret):

   ```sql
   ALTER ROLE passripple_api LOGIN PASSWORD '<generated password>';
   ```

   Generate a long random password, keep it only in the password manager, and never write it in a file.
5. **Create the Hyperdrive configuration** with the `passripple_api` connection (`API_DATABASE_URL` in `.env.example`):

   ```bash
   npx wrangler hyperdrive create passripple-db --connection-string='<passripple_api connection string>'
   ```

   The API Worker receives it as a Hyperdrive binding in its `wrangler.toml` once the API exists.

Neon suspends an idle database; the first query after a pause is slower. Keeping it awake during sales windows and event days is a scheduled job that arrives with the Workers.
