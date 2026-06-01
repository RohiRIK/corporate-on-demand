#!/usr/bin/env bun
// retro.ts — Generate retrospective report from project activity
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { parseProjectPath, hasFlag, listDepartments, getDeptDir, listMdFiles, ensureDir, readState } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun retro.ts --path <project>`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const today = new Date().toISOString().slice(0, 10);
const departments = listDepartments(projectPath);

const sections: string[] = [
  `# Retrospective — ${today}`,
  ``,
  `Generated: ${new Date().toISOString()}`,
  ``,
];

// 1. Activity Log Summary
const activityLog = join(projectPath, "activity-log.md");
if (existsSync(activityLog)) {
  const content = readFileSync(activityLog, "utf-8");
  const entries = content.split("\n").filter(l => l.startsWith("- ") || l.startsWith("* "));
  const recent = entries.slice(-20);
  sections.push(`## Recent Activity (last ${recent.length} entries)`, ``);
  for (const e of recent) sections.push(e);
  sections.push(``);
} else {
  sections.push(`## Activity Log`, ``, `_No activity-log.md found._`, ``);
}

// 2. Grade Summary
sections.push(`## Department Grades`, ``);
for (const dept of departments) {
  const gradeDir = join(getDeptDir(projectPath, dept), "grades");
  const grades = listMdFiles(gradeDir);
  if (grades.length > 0) {
    const latest = readFileSync(grades[0].path, "utf-8");
    const gradeLine = latest.split("\n").find(l => /grade|score|rating/i.test(l)) || "(see file)";
    sections.push(`- **${dept}**: ${gradeLine.replace(/^#+\s*/, "").trim()} _(${grades[0].name})_`);
  } else {
    sections.push(`- **${dept}**: _no grades_`);
  }
}
sections.push(``);

// 3. Escalations
sections.push(`## Escalations`, ``);
let escalationCount = 0;
for (const dept of departments) {
  const inboxFiles = listMdFiles(join(getDeptDir(projectPath, dept), "inbox"));
  const escalations = inboxFiles.filter(f => /escalat/i.test(f.name));
  for (const e of escalations) {
    sections.push(`- [${dept}] ${e.name}`);
    escalationCount++;
  }
}
if (escalationCount === 0) sections.push(`_No escalations found._`);
sections.push(``);

// 4. Confluence / Knowledge Base
sections.push(`## Confluence Entries`, ``);
let confluenceCount = 0;
for (const dept of departments) {
  const confDir = join(getDeptDir(projectPath, dept), "confluence");
  const docs = listMdFiles(confDir);
  if (docs.length > 0) {
    sections.push(`- **${dept}**: ${docs.length} doc(s) — latest: ${docs[0].name}`);
    confluenceCount += docs.length;
  }
}
if (confluenceCount === 0) sections.push(`_No confluence entries found._`);
sections.push(``);

// 5. Key Metrics Snapshot
const state = readState(projectPath);
sections.push(`## State Snapshot`, ``);
sections.push(`- Departments: ${departments.length}`);
if (state.phase) sections.push(`- Phase: ${state.phase}`);
if (state.sprint) sections.push(`- Sprint: ${JSON.stringify(state.sprint)}`);
sections.push(``);

// Write retro
const minutesDir = join(projectPath, "departments", "board", "minutes");
ensureDir(minutesDir);
const outPath = join(minutesDir, `${today}-retro.md`);
writeFileSync(outPath, sections.join("\n"));
console.log(`📋 Retrospective written: ${outPath}`);
console.log(`   ${departments.length} depts, ${confluenceCount} confluence docs, ${escalationCount} escalations`);
