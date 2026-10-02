import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { CONSUMER_LEVEL, checkBoundaries, findCycle, topologicalOrder } from "./boundaries.ts";
import { type Kind, loadWorkspace, parsePackage, type WorkspacePackage } from "./workspace.ts";

const CONTRACTS = "@passripple/contracts";

const namesArb = fc.uniqueArray(
  fc.stringMatching(/^[a-z]{3,10}$/).filter((n) => n !== "contracts"),
  { minLength: 5, maxLength: 15 },
);

const validWorkspaceArb = namesArb.chain((names) => {
  const pkgConfigsArb = fc.tuple(
    ...names.map((name) =>
      fc.record({
        name: fc.constant(`@passripple/${name}`),
        dir: fc.constant(name),
        kind: fc.constantFrom("core", "module", "app", "worker") as fc.Arbitrary<Kind>,
        rawLevel: fc.integer({ min: 1, max: 4 }),
      }),
    ),
  );

  return pkgConfigsArb.chain((configs) => {
    const pkgsWithDepsArb = fc.tuple(
      ...configs.map((c, i) => {
        const kind = c.kind;
        const level = kind === "core" ? 0 : kind === "module" ? c.rawLevel : undefined;
        let allowedDeps = [CONTRACTS];

        if (kind === "core") {
          allowedDeps = [CONTRACTS];
        } else if (kind === "module") {
          const prior = configs.slice(0, i).filter((dep) => {
            if (dep.kind === "app" || dep.kind === "worker") return false;
            const depLevel = dep.kind === "core" ? 0 : dep.rawLevel;
            if (depLevel === CONSUMER_LEVEL) return false;
            return depLevel <= (level ?? 0);
          });
          allowedDeps = [CONTRACTS, ...prior.map((d) => d.name)];
        } else {
          const prior = configs.slice(0, i).filter((dep) => {
            return dep.kind !== "app" && dep.kind !== "worker";
          });
          allowedDeps = [CONTRACTS, ...prior.map((d) => d.name)];
        }

        return fc.subarray(allowedDeps).map(
          (deps) =>
            ({
              name: c.name,
              dir: c.dir,
              kind,
              level,
              schema: kind === "module" ? `${c.dir}_schema` : undefined,
              internalDeps: deps,
              invalidDepSpecs: [],
            }) as WorkspacePackage,
        );
      }),
    );

    return pkgsWithDepsArb.map((pkgs) => {
      const contracts: WorkspacePackage = {
        name: CONTRACTS,
        dir: "contracts",
        kind: "core",
        level: 0,
        schema: undefined,
        internalDeps: [],
        invalidDepSpecs: [],
      };
      return [contracts, ...pkgs];
    });
  });
});

describe("boundaries properties", () => {
  test("topologicalOrder: the output is a permutation of the input and each dependency appears before whoever depends on it", () => {
    fc.assert(
      fc.property(validWorkspaceArb, (workspace) => {
        const shuffled = [...workspace].sort(() => Math.random() - 0.5);
        const ordered = topologicalOrder(shuffled);

        expect(ordered).toHaveLength(workspace.length);
        expect(new Set(ordered.map((p) => p.name))).toEqual(new Set(workspace.map((p) => p.name)));

        const seen = new Set<string>();
        for (const pkg of ordered) {
          for (const dep of pkg.internalDeps) {
            expect(seen.has(dep)).toBe(true);
          }
          seen.add(pkg.name);
        }
      }),
    );
  });

  test("findCycle: returns undefined for any acyclic graph", () => {
    fc.assert(
      fc.property(validWorkspaceArb, (workspace) => {
        expect(findCycle(workspace)).toBeUndefined();
      }),
    );
  });

  test("findCycle: if an edge that closes a cycle is injected, it returns a valid cycle", () => {
    fc.assert(
      fc.property(validWorkspaceArb, (workspace) => {
        fc.pre(workspace.length > 1);
        const modified = JSON.parse(JSON.stringify(workspace)) as WorkspacePackage[];

        // Guarantee a cycle by creating a loop A -> B -> C -> A
        const a = modified[0];
        const b = modified[Math.floor(modified.length / 2)];
        const c = modified[modified.length - 1];

        if (!a || !b || !c) return;

        if (!a.internalDeps.includes(b.name)) a.internalDeps.push(b.name);
        if (!b.internalDeps.includes(c.name)) b.internalDeps.push(c.name);
        if (!c.internalDeps.includes(a.name)) c.internalDeps.push(a.name);

        const cycle = findCycle(modified);
        expect(cycle).toBeDefined();

        const byName = new Map(modified.map((p) => [p.name, p]));
        const validCycle = cycle ?? [];
        for (let i = 0; i < validCycle.length - 1; i++) {
          const validNode = validCycle[i] as string;
          const from = byName.get(validNode);
          expect(from?.internalDeps).toContain(validCycle[i + 1]);
        }
      }),
    );
  });

  test("checkBoundaries: a valid workspace produces no errors", () => {
    fc.assert(
      fc.property(validWorkspaceArb, (workspace) => {
        expect(checkBoundaries(workspace)).toEqual([]);
      }),
    );
  });

  test("checkBoundaries: a single invalid mutation produces at least one error", () => {
    fc.assert(
      fc.property(validWorkspaceArb, fc.integer({ min: 1, max: 4 }), (workspace, mutationType) => {
        const modified = JSON.parse(JSON.stringify(workspace)) as WorkspacePackage[];
        let mutated = false;

        if (mutationType === 1) {
          const lower = modified.find((p) => p.kind === "module" && (p.level ?? 0) < 4);
          const higher = modified.find(
            (p) => p.kind === "module" && (p.level ?? 0) > (lower?.level ?? 0),
          );
          if (lower && higher) {
            lower.internalDeps.push(higher.name);
            mutated = true;
          }
        } else if (mutationType === 2) {
          const core = modified.find((p) => p.kind === "core" && p.name !== CONTRACTS);
          const other = modified.find((p) => p.name !== CONTRACTS);
          if (core && other) {
            core.internalDeps.push(other.name);
            mutated = true;
          }
        } else if (mutationType === 3) {
          const level4 = modified.find((p) => p.kind === "module" && p.level === 4);
          const nonConsumer = modified.find((p) => p.kind === "module" && (p.level ?? 0) < 4);
          if (level4 && nonConsumer) {
            nonConsumer.internalDeps.push(level4.name);
            mutated = true;
          }
        } else if (mutationType === 4) {
          const any = modified.find((p) => p.name !== CONTRACTS);
          const app = modified.find((p) => p.kind === "app" || p.kind === "worker");
          if (any && app && any.name !== app.name) {
            any.internalDeps.push(app.name);
            mutated = true;
          }
        }

        fc.pre(mutated);
        expect(checkBoundaries(modified).length).toBeGreaterThan(0);
      }),
    );
  });

  test("workspace.ts: loadWorkspace reads the current workspace without errors", () => {
    const pkgs = loadWorkspace(process.cwd());
    expect(pkgs.length).toBeGreaterThan(0);
    expect(pkgs.find((p) => p.name === "@passripple/contracts")).toBeDefined();
  });

  test("workspace.ts: parsePackage handles missing passripple and invalid kinds", () => {
    const pkg1 = parsePackage("some-dir", { name: "test-1" });
    expect(pkg1.kind).toBe("invalid");

    const pkg2 = parsePackage("some-dir", {
      name: "test-2",
      passripple: { kind: "invalid-kind" },
      dependencies: { "@passripple/core": "workspace:*" },
      devDependencies: { "@passripple/dev": "1.0.0" },
    });
    expect(pkg2.kind).toBe("invalid");
    expect(pkg2.internalDeps).toContain("@passripple/core");
    expect(pkg2.internalDeps).toContain("@passripple/dev");
    expect(pkg2.invalidDepSpecs).toContain("@passripple/dev");
  });

  test("workspace.ts: loadWorkspace handles missing dirs and invalid files", () => {
    import("node:fs").then((fs) => {
      const dir = fs.mkdtempSync("passripple-test-");
      try {
        fs.mkdirSync(`${dir}/packages`);
        fs.writeFileSync(`${dir}/packages/file.txt`, "not a dir");
        fs.mkdirSync(`${dir}/packages/empty-pkg`);

        const pkgs = loadWorkspace(dir);
        expect(pkgs.length).toBe(0);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
