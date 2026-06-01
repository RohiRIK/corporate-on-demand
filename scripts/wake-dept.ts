#!/usr/bin/env bun
// wake-dept.ts — On-demand department trigger (creates .wake marker)
import { writeFileSync } from "fs";
import { join } from "path";
import { parseProjectPath, getArg, hasFlag, getDeptDir, listDepartments, isoNow } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun wake-dept.ts --path <project> --dept <dept> --reason '...' --from <requester>
Creates a .wake marker file so data-collection scripts re-run for this department.`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const dept = getArg(args, "--dept");
const reason = getArg(args, "--reason");
const from = getArg(args, "--from");

if (!dept) { console.error("Error: --dept is required"); process.exit(1); }
if (!reason) { console.error("Error: --reason is required"); process.exit(1); }
if (!from) { console.error("Error: --from is required"); process.exit(1); }

const depts = listDepartments(projectPath);
if (!depts.includes(dept)) {
  console.error(`Error: department '${dept}' not found. Available: ${depts.join(", ")}`);
  process.exit(1);
}

const deptDir = getDeptDir(projectPath, dept);
const wakePath = join(deptDir, ".wake");
const marker = {
  reason,
  requester: from,
  timestamp: isoNow(),
};

writeFileSync(wakePath, JSON.stringify(marker, null, 2));
console.log(`✓ Wake marker created: ${wakePath}`);
console.log(`  Department: ${dept}`);
console.log(`  Reason: ${reason}`);
console.log(`  Requester: ${from}`);
