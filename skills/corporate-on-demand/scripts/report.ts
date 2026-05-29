#!/usr/bin/env bun
// report.ts -- Generate a status report for a Corporate-on-Demand project
// Usage: bun report.ts --path <project-dir>

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function usage() {
  console.log(`Usage: bun report.ts --path <project-dir>

Generates a status report showing:
  - Department grades and CEO directives
  - Artifact counts per department
  - Pipeline status
  - Recent changes
  - Pending escalations

Options:
  --path    Path to Corporate-on-Demand project
  --help    Show this help`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) { usage(); process.exit(0); }
const pathIdx = args.indexOf("--path");
const projectPath = pathIdx >= 0 && pathIdx + 1 < args.length ? args[pathIdx + 1] : "";
if (!projectPath || !existsSync(projectPath)) {
  console.error(`Error: ${projectPath ? `'${projectPath}' not found` : "--path is required"}`);
  process.exit(1);
}

function countFiles(dir: string, ext = ".md"): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => f.endsWith(ext)).length;
}

function countInbox(dir: string): { pending: number; done: number } {
  const inboxDir = join(dir, "inbox");
  const doneDir = join(inboxDir, "done");
  return {
    pending: countFiles(inboxDir),
    done: countFiles(doneDir),
  };
}

// Read state.json
const statePath = join(projectPath, "state.json");
let state: any = {};
if (existsSync(statePath)) {
  try { state = JSON.parse(readFileSync(statePath, "utf-8")); } catch { console.error("Warning: state.json is invalid JSON"); }
}

console.log(`\n╔══════════════════════════════════════════╗`);
console.log(`║  Corporate-on-Demand Status Report       ║`);
console.log(`╚══════════════════════════════════════════╝`);
console.log(`\nProject: ${projectPath}`);
console.log(`Version: ${state.version || "unknown"}`);
console.log(`Last CEO Inspection: ${state.lastCEOInspection || "never"}`);
console.log(`Last Board Meeting: ${state.lastBoardMeeting || "never"}`);

// CEO Directives
if (state.ceoDirectives && Object.keys(state.ceoDirectives).length) {
  console.log(`\n📋 CEO Directives:`);
  for (const [dept, directive] of Object.entries(state.ceoDirectives)) {
    console.log(`  ${dept}: ${directive || "(none)"}`);
  }
}

// Department Grades
if (state.departmentGrades && Object.keys(state.departmentGrades).length) {
  console.log(`\n📊 Department Grades:`);
  for (const [dept, grade] of Object.entries(state.departmentGrades)) {
    console.log(`  ${dept}: ${grade || "ungraded"}`);
  }
}

// Department Artifacts
const depsDir = join(projectPath, "departments");
if (existsSync(depsDir)) {
  const depts = readdirSync(depsDir).filter(e => statSync(join(depsDir, e)).isDirectory());
  console.log(`\n📁 Department Artifacts:`);
  for (const dept of depts) {
    const deptDir = join(depsDir, dept);
    const subdirs = readdirSync(deptDir).filter(e => statSync(join(deptDir, e)).isDirectory() && e !== "inbox");
    const inbox = countInbox(deptDir);
    const artifactCounts = subdirs.map(s => `${s}: ${countFiles(join(deptDir, s))}`).join(", ");
    console.log(`\n  [${dept}]`);
    if (artifactCounts) console.log(`    ${artifactCounts}`);
    console.log(`    inbox: ${inbox.pending} pending, ${inbox.done} done`);
  }
}

// Pipeline
if (state.pipeline) {
  console.log(`\n🔄 Pipeline Status:`);
  for (const [stage, items] of Object.entries(state.pipeline)) {
    const arr = items as string[];
    console.log(`  ${stage}: ${arr.length > 0 ? arr.join(", ") : "(empty)"}`);
  }
}

// Recent Changes
if (state.recentChanges?.length) {
  console.log(`\n📝 Recent Changes (last 10):`);
  for (const change of state.recentChanges.slice(-10)) {
    console.log(`  [${change.dept}] ${change.action} (${change.ts || "no timestamp"})`);
  }
}

// Escalations
if (state.pendingEscalations?.length) {
  console.log(`\n⚠️  Pending Escalations:`);
  for (const e of state.pendingEscalations) {
    console.log(`  - ${typeof e === "string" ? e : JSON.stringify(e)}`);
  }
}

// Blocked
if (state.blockedTasks?.length) {
  console.log(`\n🚫 Blocked Tasks:`);
  for (const t of state.blockedTasks) {
    console.log(`  - ${typeof t === "string" ? t : JSON.stringify(t)}`);
  }
}

console.log("");
