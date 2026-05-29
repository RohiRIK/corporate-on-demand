#!/usr/bin/env bun
// add-department.ts -- Add a new department to an existing Corporate-on-Demand project
// Usage: bun add-department.ts --path <dir> --name <dept> --focus <desc> --pipeline <steps>

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

function usage() {
  console.log(`Usage: bun add-department.ts --path <dir> --name <dept> --focus <desc> --pipeline <steps>

Options:
  --path       Path to existing Corporate-on-Demand project
  --name       Department name (lowercase, no spaces)
  --focus      One-line description of department focus
  --pipeline   Comma-separated pipeline steps (e.g., "research,design,build")
  --help       Show this help

Example:
  bun add-department.ts --path ~/my-project --name qa \\
    --focus "Quality assurance and testing" --pipeline "test-plan,execute,report"`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) { usage(); process.exit(0); }

const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : ""; };
const projectPath = get("--path");
const deptName = get("--name");
const focus = get("--focus");
const pipelineStr = get("--pipeline");

if (!projectPath || !deptName || !focus || !pipelineStr) {
  console.error("Error: --path, --name, --focus, and --pipeline are all required");
  process.exit(1);
}

if (!existsSync(projectPath)) { console.error(`Error: '${projectPath}' not found`); process.exit(1); }

const deptDir = join(projectPath, "departments", deptName);
if (existsSync(deptDir)) { console.error(`Error: Department '${deptName}' already exists at ${deptDir}`); process.exit(1); }

const pipelineSteps = pipelineStr.split(",").map(s => s.trim()).filter(Boolean);

// Create department directory structure
mkdirSync(deptDir, { recursive: true });
for (const step of pipelineSteps) {
  mkdirSync(join(deptDir, step), { recursive: true });
}
mkdirSync(join(deptDir, "inbox", "done"), { recursive: true });

// Generate SYSTEM.md
const systemMd = `# ${deptName.toUpperCase()} Department

## Identity
You are the ${deptName.toUpperCase()} department. Your focus: ${focus}.

## Pipeline
\`${pipelineSteps.join(" → ")}\`

Follow this pipeline strictly. Do NOT skip steps.

## Anti-Slop Contract
- No filler words: leverage, utilize, enhance, streamline, robust, seamless
- No vague reports -- every claim must have a specific example
- No placeholders -- every TODO must be resolved before shipping
- No generic names: data, result, thing → use domain-specific names
- Every sentence must carry information
- If nothing useful to do, say "No actionable work this cycle" and stop
`;

writeFileSync(join(deptDir, "SYSTEM.md"), systemMd);
console.log(`Created: ${deptDir}/SYSTEM.md`);
console.log(`Created subdirs: ${pipelineSteps.join(", ")}, inbox`);

// Update CORPORATE.md
const corpPath = join(projectPath, "departments", "CORPORATE.md");
if (existsSync(corpPath)) {
  let corp = readFileSync(corpPath, "utf-8");
  // Find the execution order list and append
  const orderMatch = corp.match(/(## Execution Order\n)([\s\S]*?)(\n## )/);
  if (orderMatch) {
    const lines = orderMatch[2].trim().split("\n");
    const nextNum = lines.length + 1;
    const newLine = `${nextNum}. ${deptName}`;
    corp = corp.replace(orderMatch[2], orderMatch[2].trimEnd() + "\n" + newLine + "\n");
    writeFileSync(corpPath, corp);
    console.log(`Updated: CORPORATE.md execution order`);
  }
}

// Update state.json
const statePath = join(projectPath, "state.json");
if (existsSync(statePath)) {
  try {
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    if (state.ceoDirectives) state.ceoDirectives[deptName] = "";
    if (state.departmentGrades) state.departmentGrades[deptName] = "";
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log(`Updated: state.json`);
  } catch { console.error("Warning: Could not update state.json"); }
}

// Create data-collection script
const projectName = projectPath.split("/").pop() || "project";
const hermesScriptsDir = join(process.env.HOME || "~", ".hermes", "scripts");
mkdirSync(hermesScriptsDir, { recursive: true });

const scriptContent = `#!/bin/bash
# Data collection for ${projectName} ${deptName} department
PROJ="${projectPath}"
DEPT="$PROJ/departments/${deptName}"

echo "=== CORPORATE GOVERNANCE ==="
cat "$PROJ/departments/CORPORATE.md"

echo "=== DEPARTMENT IDENTITY ==="
cat "$DEPT/SYSTEM.md"

echo "=== INBOX ==="
for f in "$DEPT/inbox"/*.md; do [ -f "$f" ] && echo "--- $f ---" && cat "$f"; done

${pipelineSteps.map(s => `echo "=== ${s.toUpperCase()} ==="\nfor f in "$DEPT/${s}"/*.md; do [ -f "$f" ] && echo "--- $f ---" && cat "$f"; done`).join("\n\n")}

echo "=== SHARED STATE ==="
cat "$PROJ/state.json"
`;

const scriptPath = join(hermesScriptsDir, `${projectName}-${deptName}.sh`);
writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
console.log(`Created: ${scriptPath}`);

console.log(`\n✅ Department '${deptName}' added successfully`);
console.log(`\n📋 Create cron job with:`);
console.log(`hermes cron create --name ${projectName}-${deptName} --schedule "0 */2 * * *" --script ${projectName}-${deptName}.sh --workdir ${projectPath} --toolsets terminal,file --deliver telegram`);
