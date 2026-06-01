#!/usr/bin/env bun
// metrics.ts — Collect and report project metrics
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { parseProjectPath, getArg, hasFlag, listDepartments, getDeptDir, listMdFiles, readState } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun metrics.ts --path <project> [--format json|md]`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const format = getArg(args, "--format") || "md";
const departments = listDepartments(projectPath);

function countFiles(dir: string, ext = ".md"): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter(f => f.endsWith(ext)).length;
  } catch { return 0; }
}

function countAllFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) count++;
      else if (entry.isDirectory()) count += countAllFiles(join(dir, entry.name));
    }
    return count;
  } catch { return 0; }
}

interface DeptMetrics {
  department: string;
  artifacts: number;
  inbox: number;
  inboxDone: number;
  confluence: number;
  grades: number;
}

const metrics: DeptMetrics[] = [];
let totalArtifacts = 0, totalInbox = 0, totalConfluence = 0, totalGrades = 0;

for (const dept of departments) {
  const d = getDeptDir(projectPath, dept);
  const artifacts = countAllFiles(d) - countFiles(join(d, "inbox")) - countFiles(join(d, "inbox", "done")) - countFiles(join(d, "grades")) - countFiles(join(d, "confluence"));
  const inbox = countFiles(join(d, "inbox"));
  const inboxDone = countFiles(join(d, "inbox", "done"));
  const confluence = countFiles(join(d, "confluence"));
  const grades = countFiles(join(d, "grades"));

  const m: DeptMetrics = { department: dept, artifacts: Math.max(0, artifacts), inbox, inboxDone, confluence, grades };
  metrics.push(m);
  totalArtifacts += m.artifacts;
  totalInbox += inbox;
  totalConfluence += confluence;
  totalGrades += grades;
}

// Pipeline / state info
const state = readState(projectPath);

if (format === "json") {
  const output = {
    generated: new Date().toISOString(),
    summary: { departments: departments.length, totalArtifacts, totalInbox, totalConfluence, totalGrades, phase: state.phase || null },
    departments: metrics,
  };
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`# Project Metrics — ${new Date().toISOString().slice(0, 10)}`);
  console.log(``);
  console.log(`## Summary`);
  console.log(``);
  console.log(`- Departments: ${departments.length}`);
  console.log(`- Total artifacts: ${totalArtifacts}`);
  console.log(`- Total inbox items: ${totalInbox}`);
  console.log(`- Total confluence docs: ${totalConfluence}`);
  console.log(`- Total grades: ${totalGrades}`);
  if (state.phase) console.log(`- Phase: ${state.phase}`);
  console.log(``);
  console.log(`## Per Department`);
  console.log(``);
  console.log(`| Department | Artifacts | Inbox | Done | Confluence | Grades |`);
  console.log(`|------------|-----------|-------|------|------------|--------|`);
  for (const m of metrics) {
    console.log(`| ${m.department} | ${m.artifacts} | ${m.inbox} | ${m.inboxDone} | ${m.confluence} | ${m.grades} |`);
  }
}
