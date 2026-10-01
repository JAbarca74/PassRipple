import { describe, expect, it } from "vitest";
import { topologicalOrder } from "./boundaries.ts";
import { moduleSpecs, schemaArrayLiteral } from "./db-modules.ts";
import { type Kind, loadWorkspace, type WorkspacePackage } from "./workspace.ts";

function pkg(
  name: string,
  kind: Kind,
  level: number | undefined,
  deps: string[] = [],
  schema?: string,
): WorkspacePackage {
  return {
    name: `@passripple/${name}`,
    dir: name,
    kind,
    level,
    schema: kind === "module" ? (schema ?? name) : undefined,
    internalDeps: deps.map((d) => `@passripple/${d}`),
    invalidDepSpecs: [],
  };
}

describe("moduleSpecs", () => {
  it("keeps modules only, in the given order, with the schemas they depend on", () => {
    const specs = moduleSpecs([
      pkg("contracts", "core", 0),
      pkg("identity", "module", 1, ["contracts"]),
      pkg("events", "module", 1, ["contracts", "identity"]),
      pkg("door-sales", "module", 3, ["events", "identity"], "door_sales"),
      pkg("api", "worker", undefined, ["door-sales"]),
    ]);
    expect(specs).toEqual([
      { name: "@passripple/identity", schema: "identity", level: 1, dependsOn: [] },
      { name: "@passripple/events", schema: "events", level: 1, dependsOn: ["identity"] },
      {
        name: "@passripple/door-sales",
        schema: "door_sales",
        level: 3,
        dependsOn: ["events", "identity"],
      },
    ]);
  });

  it("rejects a module listed before one of its dependencies", () => {
    expect(() =>
      moduleSpecs([pkg("events", "module", 1, ["identity"]), pkg("identity", "module", 1)]),
    ).toThrow(/listed before its dependency @passripple\/identity/);
  });

  it("rejects a schema name that is not a plain lowercase identifier", () => {
    expect(() => moduleSpecs([pkg("evil", "module", 1, [], 'x"; DROP TABLE y; --')])).toThrow(
      /invalid database schema name/,
    );
    expect(() => moduleSpecs([pkg("upper", "module", 1, [], "Events")])).toThrow(
      /invalid database schema name/,
    );
    const noSchema = pkg("none", "module", 1);
    noSchema.schema = undefined;
    expect(() => moduleSpecs([noSchema])).toThrow(/invalid database schema name ""/);
  });

  it("rejects a module without a level", () => {
    expect(() => moduleSpecs([pkg("identity", "module", undefined)])).toThrow(/declare a level/);
  });

  it("describes every module of the real workspace, each after its dependencies", () => {
    const specs = moduleSpecs(topologicalOrder(loadWorkspace(process.cwd())));
    expect(specs.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const spec of specs) {
      for (const dep of spec.dependsOn) expect(seen.has(dep)).toBe(true);
      seen.add(spec.schema);
    }
  });
});

describe("schemaArrayLiteral", () => {
  it("builds a PostgreSQL array literal", () => {
    expect(schemaArrayLiteral([])).toBe("{}");
    expect(schemaArrayLiteral(["events", "door_sales"])).toBe("{events,door_sales}");
  });

  it("rejects anything that would need quoting", () => {
    expect(() => schemaArrayLiteral(["events", "a,b"])).toThrow(/invalid schema name "a,b"/);
    expect(() => schemaArrayLiteral(["}"])).toThrow(/invalid schema name/);
  });
});
