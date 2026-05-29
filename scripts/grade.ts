#!/usr/bin/env bun
// grade.ts — CEO grades a department
import { writeFileSync } from "fs";
import { join } from "path";
import { parseProjectPath, getArg, hasFlag, readState, writeState, getDeptDir, ensureDir, fileTimestamp, isoNow, listDepartments } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun grade.ts --path <project> --dept <dept> --grade <A-F> --reason "..."`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const dept = getArg(args, "--dept");
const grade = getArg(args, "--grade");
const reason = getArg(args, "--reason") || "";

if (!dept || !grade) { console.error("Error: --dept and --grade required"); process.exit(1); }
if (!listDepartments(projectPath).includes(dept)) { console.error(`Error: department '${dept}' not found`); process.exit(1); }

const state = readState(projectPath);
if (!state.departmentGrades) state.departmentGrades = {};
state.departmentGrades[dept] = grade;
if (!state.recentChanges) state.recentChanges = [];
state.recentChanges.push({ dept: "ceo", action: `Graded ${dept}: ${grade} — ${reason}`, ts: isoNow() });
writeState(projectPath, state);

const reviewDir = join(getDeptDir(projectPath, "ceo"), "reviews");
ensureDir(reviewDir);
const reviewPath = join(reviewDir, `${fileTimestamp()}-${dept}-grade.md`);
writeFileSync(reviewPath, `# Grade Review: ${dept.toUpperCase()}
Grade: ${grade}
Date: ${isoNow()}
Reviewer: CEO

## Assessment
${reason || "No reason provided."}
`);

console.log(`Graded ${dept}: ${grade}`);
console.log(`Review: ${reviewPath}`);
