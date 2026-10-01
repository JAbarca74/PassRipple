// Database helper: applies migrations in dependency order and runs pgTAP tests.
//
//   node scripts/db.ts migrate   apply bootstrap SQL, then each module's new migrations,
//                                each one as the module's owner role (rule R1)
//   node scripts/db.ts test      run db/tests and every module's db/tests with pgTAP
//
// Connects with DATABASE_URL (default: the local database from db/compose.yaml).
// Requires the psql client on PATH.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { topologicalOrder } from "./lib/boundaries.ts";
import { moduleSpecs, schemaArrayLiteral } from "./lib/db-modules.ts";
import { loadWorkspace } from "./lib/workspace.ts";

const ROOT = process.cwd();
const LOCAL_URL = "postgres://passripple@localhost:54329/passripple";
const DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_URL;

function psql(input: string, variables: Record<string, string> = {}): string {
  const args = [DATABASE_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  for (const [key, value] of Object.entries(variables)) args.push("-v", `${key}=${value}`);
  const result = spawnSync("psql", args, { input, encoding: "utf8" });
  if (result.error) {
    throw new Error(`could not run psql: ${result.error.message}. Install the PostgreSQL client.`);
  }
  if (result.status !== 0) {
    throw new Error(`${result.stdout}${result.stderr}`.trim());
  }
  return result.stdout;
}

function sqlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => join(dir, file));
}

// psql reads backslashes in quoted arguments as escapes, so Windows paths use forward slashes.
function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

function include(path: string): string {
  return `\\i '${toPosix(path)}'\n`;
}

function modulesInOrder() {
  return topologicalOrder(loadWorkspace(ROOT)).filter((pkg) => pkg.kind === "module");
}

function migrate(): void {
  for (const file of sqlFiles(join(ROOT, "db", "bootstrap"))) {
    psql(include(file));
  }

  let applied = 0;
  const modules = modulesInOrder();
  const specs = moduleSpecs(modules);
  for (const [index, mod] of modules.entries()) {
    const spec = specs[index];
    if (spec?.name !== mod.name) throw new Error(`module order mismatch at ${mod.name}`);

    // Creates the owner role and schema, and syncs read access to the module's dependencies.
    const owner = psql(
      "SELECT migrations.prepare_module(:'module', :'schema', :'level'::integer, :'deps'::text[]);\n",
      {
        module: spec.name,
        schema: spec.schema,
        level: String(spec.level),
        deps: schemaArrayLiteral(spec.dependsOn),
      },
    ).trim();

    for (const path of sqlFiles(join(mod.dir, "db", "migrations"))) {
      // Recorded with forward slashes so the same database works from any OS.
      const file = toPosix(path.slice(mod.dir.length + 1));
      const checksum = createHash("sha256").update(readFileSync(path)).digest("hex");
      const vars = { module: mod.name, file, checksum, owner };

      const existing = psql(
        "SELECT checksum FROM migrations.applied WHERE module = :'module' AND file = :'file';\n",
        vars,
      ).trim();

      if (existing === checksum) continue;
      if (existing) {
        throw new Error(
          `${mod.name}/${file} was modified after being applied. Migrations are immutable: write a new one.`,
        );
      }

      // The migration runs as the module's owner role, so it can only create objects in its
      // own schema and only read the schemas of the modules it depends on.
      psql(
        [
          "BEGIN;",
          "SELECT migrations.allow_schema_creation(:'owner', true);",
          'SET LOCAL ROLE :"owner";',
          include(path),
          "RESET ROLE;",
          "SELECT migrations.allow_schema_creation(:'owner', false);",
          "INSERT INTO migrations.applied (module, file, checksum) VALUES (:'module', :'file', :'checksum');",
          "COMMIT;\n",
        ].join("\n"),
        vars,
      );
      console.log(`applied ${mod.name}/${file}`);
      applied++;
    }
  }
  console.log(applied === 0 ? "Database is up to date." : `Applied ${applied} migration(s).`);
}

function test(): void {
  psql("CREATE EXTENSION IF NOT EXISTS pgtap;\n");
  const files = [
    ...sqlFiles(join(ROOT, "db", "tests")),
    ...modulesInOrder().flatMap((mod) => sqlFiles(join(mod.dir, "db", "tests"))),
  ];

  const failures: string[] = [];
  for (const file of files) {
    const name = file.slice(ROOT.length + 1);
    try {
      const output = psql(include(file));
      if (/^not ok/m.test(output)) throw new Error(output);
      console.log(`ok   ${name}`);
    } catch (error) {
      console.log(`FAIL ${name}`);
      failures.push(`${name}\n${(error as Error).message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${files.length} test file(s) failed:\n`);
    for (const failure of failures) console.error(`${failure}\n`);
    process.exit(1);
  }
  console.log(`\nAll ${files.length} test file(s) passed.`);
}

const command = process.argv[2];
try {
  if (command === "migrate") migrate();
  else if (command === "test") test();
  else {
    console.error("usage: node scripts/db.ts <migrate|test>");
    process.exit(2);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
