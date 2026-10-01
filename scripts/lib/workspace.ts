import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Kind = "core" | "module" | "app" | "worker";

export interface WorkspacePackage {
  name: string;
  dir: string;
  kind: Kind | "invalid";
  level: number | undefined;
  schema: string | undefined;
  internalDeps: string[];
  invalidDepSpecs: string[];
}

export const WORKSPACE_DIRS = ["packages", "modules", "apps", "workers"] as const;
export const SCOPE = "@passwave/";

const KINDS: readonly Kind[] = ["core", "module", "app", "worker"];

interface RawPackageJson {
  name?: string;
  passwave?: { kind?: string; level?: number; schema?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export function loadWorkspace(root: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const group of WORKSPACE_DIRS) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(groupDir, entry.name);
      const manifest = join(dir, "package.json");
      if (!existsSync(manifest)) continue;
      packages.push(
        parsePackage(dir, JSON.parse(readFileSync(manifest, "utf8")) as RawPackageJson),
      );
    }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

function isKind(value: string | undefined): value is Kind {
  return (KINDS as readonly (string | undefined)[]).includes(value);
}

export function parsePackage(dir: string, raw: RawPackageJson): WorkspacePackage {
  const kind = raw.passwave?.kind;
  const all = { ...raw.dependencies, ...raw.devDependencies, ...raw.peerDependencies };
  const internal = Object.entries(all).filter(([dep]) => dep.startsWith(SCOPE));
  return {
    name: raw.name ?? dir,
    dir,
    kind: isKind(kind) ? kind : "invalid",
    level: raw.passwave?.level,
    schema: raw.passwave?.schema,
    internalDeps: internal.map(([dep]) => dep).sort(),
    invalidDepSpecs: internal.filter(([, spec]) => spec !== "workspace:*").map(([dep]) => dep),
  };
}
