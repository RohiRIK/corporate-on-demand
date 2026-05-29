#!/usr/bin/env bun
// csuite-report.ts — Role-specific C-Suite report
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseProjectPath, getArg, hasFlag, readState, listDepartments, getDeptDir, listMdFiles, parseSince, truncate } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun csuite-report.ts --path <project> --role ceo|cto|ciso|cpo`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const role = getArg(args, "--role");
if (!role || !["ceo", "cto", "ciso", "cpo"].includes(role)) {
  console.error("Error: --role must be ceo|cto|ciso|cpo"); process.exit(1);
}

const state = readState(projectPath);
const since24h = parseSince("24h");

function inboxSummary(dept: string): string {
  const dir = join(getDeptDir(projectPath, dept), "inbox");
  const pending = listMdFiles(dir);
  const done = listMdFiles(join(dir, "done"));
  return `${dept}: ${pending.length} pending, ${done.length} done`;
}

function artifactSummary(dept: string, subdirs: string[]): string {
  const lines: string[] = [];
  for (const sub of subdirs) {
    const files = listMdFiles(join(getDeptDir(projectPath, dept), sub));
    if (files.length) {
      lines.push(`  ${sub}/: ${files.length} files (newest: ${files[0].mtime.toISOString().slice(0, 10)})`);
    }
  }
  return lines.join("\n") || "  (none)";
}

function activityLog(): string {
  return (state.recentChanges || [])
    .filter((e: any) => new Date(e.ts) >= since24h)
    .map((e: any) => `  [${e.ts}] ${e.dept}: ${e.action}`)
    .join("\n") || "  (no recent activity)";
}

function securityScan(): string {
  const keywords = ["security", "vulnerability", "cve", "breach", "access", "auth"];
  const results: string[] = [];
  for (const dept of listDepartments(projectPath)) {
    const files = listMdFiles(join(getDeptDir(projectPath, dept), "inbox"));
    for (const f of files) {
      const content = readFileSync(f.path, "utf-8").toLowerCase();
      if (keywords.some(k => content.includes(k))) {
        results.push(`  [${dept}] ${f.name}`);
      }
    }
  }
  return results.join("\n") || "  (no security-related items)";
}

console.log(`# ${role.toUpperCase()} Report — ${new Date().toISOString().slice(0, 10)}\n`);

if (role === "ceo") {
  console.log("## Department Grades");
  for (const [d, g] of Object.entries(state.departmentGrades || {})) console.log(`  ${d}: ${g || "ungraded"}`);
  console.log("\n## Escalations");
  (state.pendingEscalations || []).forEach((e: any) => console.log(`  - ${JSON.stringify(e)}`));
  console.log("\n## Pipeline");
  for (const [k, v] of Object.entries(state.pipeline || {})) console.log(`  ${k}: ${(v as string[]).length} items`);
  console.log("\n## Blocked Tasks");
  (state.blockedTasks || []).forEach((t: any) => console.log(`  - ${JSON.stringify(t)}`));
  console.log("\n## Activity (24h)");
  console.log(activityLog());
  console.log("\n## Inbox Digests");
  for (const d of listDepartments(projectPath)) console.log(`  ${inboxSummary(d)}`);
} else if (role === "cto") {
  console.log("## Tech Departments");
  for (const dept of ["rnd", "infra", "it"]) {
    if (listDepartments(projectPath).includes(dept)) {
      console.log(`\n### ${dept.toUpperCase()}`);
      console.log(artifactSummary(dept, ["specs", "prototypes", "runbooks", "research", "pitches", "audits"]));
    }
  }
  console.log("\n## Pipeline (Tech)");
  console.log(`  researched: ${(state.pipeline?.researched || []).length}`);
  console.log(`  specced: ${(state.pipeline?.specced || []).length}`);
  console.log("\n## Tech Escalations");
  (state.pendingEscalations || []).filter((e: any) => ["rnd", "infra", "it"].includes(e.dept)).forEach((e: any) => console.log(`  - ${JSON.stringify(e)}`));
} else if (role === "ciso") {
  console.log("## Infra Audits");
  console.log(artifactSummary("infra", ["audits"]));
  console.log("\n## Security-Tagged Inbox Items");
  console.log(securityScan());
  console.log("\n## Escalations");
  (state.pendingEscalations || []).forEach((e: any) => console.log(`  - ${JSON.stringify(e)}`));
} else if (role === "cpo") {
  console.log("## UX/UI Artifacts");
  console.log(artifactSummary("uxui", ["designs", "styleguide", "research"]));
  console.log("\n## Staleness");
  const designFiles = listMdFiles(join(getDeptDir(projectPath, "uxui"), "designs"));
  const old = designFiles.filter(f => f.mtime < new Date(Date.now() - 7 * 86400000));
  console.log(`  Total design files: ${designFiles.length}, older than 7d: ${old.length}`);
  console.log("\n## Pipeline (Product)");
  console.log(`  built: ${(state.pipeline?.built || []).length}`);
}
