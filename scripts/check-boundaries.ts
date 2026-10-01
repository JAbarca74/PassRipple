// Fails if any package breaks the module boundary rules in docs/architecture.md.
import { checkBoundaries } from "./lib/boundaries.ts";
import { loadWorkspace } from "./lib/workspace.ts";

const packages = loadWorkspace(process.cwd());
const errors = checkBoundaries(packages);

if (errors.length > 0) {
  console.error(`Module boundary violations (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Module boundaries OK (${packages.length} packages).`);
