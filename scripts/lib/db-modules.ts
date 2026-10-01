import type { WorkspacePackage } from "./workspace.ts";

/** What the migration runner needs to know about a module to prepare its database role. */
export interface ModuleSpec {
  name: string;
  schema: string;
  level: number;
  /** Schemas of the modules it depends on: the only schemas its role may read. */
  dependsOn: string[];
}

const SCHEMA_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Turns workspace packages, already in dependency order, into module specs in the same
 * order. Core packages, apps and workers own no schema and are left out.
 */
export function moduleSpecs(ordered: WorkspacePackage[]): ModuleSpec[] {
  const modules = ordered.filter((pkg) => pkg.kind === "module");
  const isModule = new Set(modules.map((pkg) => pkg.name));
  const schemaOf = new Map<string, string>();
  const specs: ModuleSpec[] = [];
  for (const pkg of modules) {
    if (!pkg.schema || !SCHEMA_NAME.test(pkg.schema)) {
      throw new Error(`${pkg.name}: invalid database schema name "${pkg.schema ?? ""}"`);
    }
    if (pkg.level === undefined) throw new Error(`${pkg.name}: modules must declare a level`);
    const dependsOn: string[] = [];
    for (const dep of pkg.internalDeps) {
      if (!isModule.has(dep)) continue;
      const schema = schemaOf.get(dep);
      if (!schema) throw new Error(`${pkg.name}: listed before its dependency ${dep}`);
      dependsOn.push(schema);
    }
    schemaOf.set(pkg.name, pkg.schema);
    specs.push({
      name: pkg.name,
      schema: pkg.schema,
      level: pkg.level,
      dependsOn: dependsOn.sort(),
    });
  }
  return specs;
}

/** PostgreSQL array literal for schema names, which never need quoting. */
export function schemaArrayLiteral(schemas: string[]): string {
  for (const schema of schemas) {
    if (!SCHEMA_NAME.test(schema)) throw new Error(`invalid schema name "${schema}"`);
  }
  return `{${schemas.join(",")}}`;
}
