import type { WorkspacePackage } from "./workspace.ts";

/** Level of consumer modules: nothing but apps and workers may depend on them. */
export const CONSUMER_LEVEL = 4;
const MAX_LEVEL = 4;
const CONTRACTS = "@passwave/contracts";

/**
 * Checks the module boundary rules described in docs/architecture.md.
 * Returns a list of human-readable violations; an empty list means the graph is valid.
 */
export function checkBoundaries(packages: WorkspacePackage[]): string[] {
  const errors: string[] = [];
  const byName = new Map(packages.map((p) => [p.name, p]));
  const schemas = new Map<string, string>();

  for (const pkg of packages) {
    if (pkg.kind === "invalid") {
      errors.push(`${pkg.name}: "passwave.kind" must be one of core, module, app, worker`);
      continue;
    }
    if (pkg.kind === "core" && pkg.level !== 0) {
      errors.push(`${pkg.name}: core packages must have level 0`);
    }
    if (pkg.kind === "module") {
      if (!Number.isInteger(pkg.level) || (pkg.level ?? 0) < 1 || (pkg.level ?? 0) > MAX_LEVEL) {
        errors.push(`${pkg.name}: modules must have an integer level from 1 to ${MAX_LEVEL}`);
      }
      if (!pkg.schema) {
        errors.push(`${pkg.name}: modules must declare the database schema they own`);
      } else if (schemas.has(pkg.schema)) {
        errors.push(
          `${pkg.name}: schema "${pkg.schema}" is already owned by ${schemas.get(pkg.schema)}`,
        );
      } else {
        schemas.set(pkg.schema, pkg.name);
      }
    }
    for (const dep of pkg.invalidDepSpecs) {
      errors.push(`${pkg.name}: internal dependency ${dep} must use "workspace:*"`);
    }

    for (const depName of pkg.internalDeps) {
      const dep = byName.get(depName);
      if (!dep) {
        errors.push(`${pkg.name}: depends on unknown internal package ${depName}`);
        continue;
      }
      const violation = dependencyViolation(pkg, dep);
      if (violation) errors.push(`${pkg.name} -> ${dep.name}: ${violation}`);
    }
  }

  const cycle = findCycle(packages);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(" -> ")}`);
  return errors;
}

function dependencyViolation(pkg: WorkspacePackage, dep: WorkspacePackage): string | undefined {
  if (dep.kind === "app" || dep.kind === "worker") {
    return "apps and workers are composition roots; nothing may depend on them";
  }
  if (pkg.kind === "app" || pkg.kind === "worker") return undefined;

  if (pkg.kind === "core") {
    return dep.name === CONTRACTS
      ? undefined
      : "core packages may only depend on @passwave/contracts";
  }

  // pkg is a module
  if (dep.kind === "core") return undefined;
  if (dep.level === CONSUMER_LEVEL) {
    return `level ${CONSUMER_LEVEL} modules are consumers; only apps and workers may depend on them`;
  }
  if ((dep.level ?? 0) > (pkg.level ?? 0)) {
    return `dependencies must point down: level ${pkg.level} cannot depend on level ${dep.level}`;
  }
  return undefined;
}

/** Returns one dependency cycle if the graph has any, otherwise undefined. */
export function findCycle(packages: WorkspacePackage[]): string[] | undefined {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (name: string): string[] | undefined => {
    if (state.get(name) === "done") return undefined;
    if (state.get(name) === "visiting") return [...stack.slice(stack.indexOf(name)), name];
    state.set(name, "visiting");
    stack.push(name);
    for (const dep of byName.get(name)?.internalDeps ?? []) {
      if (!byName.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(name, "done");
    return undefined;
  };

  for (const pkg of packages) {
    const cycle = visit(pkg.name);
    if (cycle) return cycle;
  }
  return undefined;
}

/** Orders packages so that every package comes after all of its dependencies. */
export function topologicalOrder(packages: WorkspacePackage[]): WorkspacePackage[] {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const ordered: WorkspacePackage[] = [];
  const seen = new Set<string>();

  const visit = (pkg: WorkspacePackage): void => {
    if (seen.has(pkg.name)) return;
    seen.add(pkg.name);
    for (const depName of pkg.internalDeps) {
      const dep = byName.get(depName);
      if (dep) visit(dep);
    }
    ordered.push(pkg);
  };

  for (const pkg of [...packages].sort((a, b) => a.name.localeCompare(b.name))) visit(pkg);
  return ordered;
}
