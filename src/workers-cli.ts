/**
 * Print the workspace's workers, one per line, as `department/worker`.
 *
 * Exists so the container entrypoint can ask the schema what a worker is
 * instead of grepping the file. The previous `sed 's/.*"name".../'` matched
 * every `"name"` key in the document — the company, the departments, every
 * worker AND every cron job — and created a work directory for each. Wrong,
 * and quietly so: nothing failed, there were just seven directories where
 * three belonged.
 *
 * Exits non-zero on an invalid workspace, so the entrypoint can refuse rather
 * than start an agent workspace it does not understand.
 */

import { readFileSync } from "node:fs";
import { Workspace } from "./workspace";

const path = process.argv[2] ?? "/cod/cod.json";

let raw: string;
try {
  raw = readFileSync(path, "utf8");
} catch (error) {
  process.stderr.write(`cannot read ${path}: ${(error as Error).message}\n`);
  process.exit(2);
}

const parsed = Workspace.safeParse(JSON.parse(raw) as unknown);
if (!parsed.success) {
  process.stderr.write(`workspace is invalid: ${parsed.error.message}\n`);
  process.exit(2);
}

for (const department of parsed.data.departments) {
  for (const worker of department.workers) {
    process.stdout.write(`${department.name}/${worker.name}\n`);
  }
}
