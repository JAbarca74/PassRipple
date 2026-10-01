import { describe, expect, it } from "vitest";
import { checkBoundaries, findCycle, topologicalOrder } from "./boundaries.ts";
import type { Kind, WorkspacePackage } from "./workspace.ts";

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

const base = [
  pkg("contracts", "core", 0),
  pkg("crypto", "core", 0, ["contracts"]),
  pkg("identity", "module", 1, ["contracts"]),
  pkg("events", "module", 1, ["contracts", "identity"]),
  pkg("ticketing", "module", 2, ["crypto", "events"]),
  pkg("audit", "module", 4, ["contracts"]),
  pkg("api", "worker", undefined, ["ticketing", "audit"]),
];

describe("checkBoundaries", () => {
  it("accepts a valid graph, including same-level dependencies", () => {
    expect(checkBoundaries(base)).toEqual([]);
  });

  it("rejects a dependency that points up a level", () => {
    const errors = checkBoundaries([...base, pkg("catalog", "module", 1, ["ticketing"])]);
    expect(errors.join("\n")).toMatch(/level 1 cannot depend on level 2/);
  });

  it("rejects a module depending on a consumer module", () => {
    const errors = checkBoundaries([...base, pkg("orders", "module", 3, ["audit"])]);
    expect(errors.join("\n")).toMatch(/consumers/);
  });

  it("rejects a core package depending on anything but contracts", () => {
    const errors = checkBoundaries([...base, pkg("pricing", "core", 0, ["crypto"])]);
    expect(errors.join("\n")).toMatch(/only depend on @passripple\/contracts/);
  });

  it("rejects depending on an app or worker", () => {
    const errors = checkBoundaries([...base, pkg("seo", "module", 4, ["api"])]);
    expect(errors.join("\n")).toMatch(/composition roots/);
  });

  it("rejects two modules owning the same schema", () => {
    const errors = checkBoundaries([...base, pkg("tickets2", "module", 2, [], "ticketing")]);
    expect(errors.join("\n")).toMatch(/already owned/);
  });

  it("rejects a module without a valid level", () => {
    const errors = checkBoundaries([...base, pkg("orders", "module", 7)]);
    expect(errors.join("\n")).toMatch(/integer level/);
  });
});

describe("findCycle", () => {
  it("finds a cycle between same-level modules", () => {
    const cyclic = [
      pkg("contracts", "core", 0),
      pkg("identity", "module", 1, ["events"]),
      pkg("events", "module", 1, ["identity"]),
    ];
    const cycle = findCycle(cyclic) ?? [];
    expect(cycle).toHaveLength(3);
    expect(cycle[0]).toBe(cycle[2]);
    expect(new Set(cycle)).toEqual(new Set(["@passripple/identity", "@passripple/events"]));
  });

  it("returns undefined for an acyclic graph", () => {
    expect(findCycle(base)).toBeUndefined();
  });
});

describe("topologicalOrder", () => {
  it("places every package after its dependencies", () => {
    const order = topologicalOrder(base).map((p) => p.name);
    for (const p of base) {
      for (const dep of p.internalDeps) {
        expect(order.indexOf(dep)).toBeLessThan(order.indexOf(p.name));
      }
    }
  });
});
