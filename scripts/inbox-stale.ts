#!/usr/bin/env bun
// inbox-stale.ts — Scan department inboxes for stale items (>3 cycles old)
import { readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { parseProjectPath, getArg, hasFlag, listDepartments, getDeptDir, listMdFiles, ensureDir, fileTimestamp } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun inbox-stale.ts --path <project> --action <scan|escalate> [--cycles 3]`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const action = getArg(args, "--action") || "scan";
const maxCycles = parseInt(getArg(args, "--cycles") || "3", 10);

// Estimate cycle age from filename timestamp patterns: YYYY-MM-DD or ISO-like
function extractTimestamp(filename: string): Date | null {
  // Try ISO-like: 2025-05-30_14-30-00
  const isoMatch = filename.match(/(\d{4}-\d{2}-\d{2})[_T](\d{2})-(\d{2})-(\d{2})/);
  if (isoMatch) return new Date(`${isoMatch[1]}T${isoMatch[2]}:${isoMatch[3]}:${isoMatch[4]}`);
  // Try date-only: 2025-05-30
  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) return new Date(dateMatch[1]);
  return null;
}

// A "cycle" is ~24h for this heuristic
const cycleMs = 24 * 60 * 60 * 1000;
const cutoff = new Date(Date.now() - maxCycles * cycleMs);

interface StaleItem {
  dept: string;
  file: string;
  age: string;
  timestamp: Date;
}

const staleItems: StaleItem[] = [];
const departments = listDepartments(projectPath);

for (const dept of departments) {
  const inboxDir = join(getDeptDir(projectPath, dept), "inbox");
  const files = listMdFiles(inboxDir);
  for (const f of files) {
    const ts = extractTimestamp(f.name) || f.mtime;
    if (ts < cutoff) {
      const ageDays = Math.floor((Date.now() - ts.getTime()) / cycleMs);
      staleItems.push({ dept, file: f.name, age: `${ageDays}d`, timestamp: ts });
    }
  }
}

if (action === "scan") {
  if (staleItems.length === 0) {
    console.log("✅ No stale inbox items found.");
  } else {
    console.log(`⚠️  ${staleItems.length} stale inbox item(s) (>${maxCycles} cycles):\n`);
    for (const item of staleItems) {
      console.log(`  [${item.dept}] ${item.file} — ${item.age} old`);
    }
  }
} else if (action === "escalate") {
  if (staleItems.length === 0) {
    console.log("✅ No stale items to escalate.");
    process.exit(0);
  }

  const ceoInbox = join(getDeptDir(projectPath, "ceo"), "inbox");
  ensureDir(ceoInbox);

  const ts = fileTimestamp();
  const escalationPath = join(ceoInbox, `${ts}-stale-escalation.md`);

  const lines = [
    `# Stale Inbox Escalation`,
    ``,
    `From: Automation (inbox-stale)`,
    `Date: ${new Date().toISOString()}`,
    `Priority: HIGH`,
    ``,
    `The following ${staleItems.length} inbox item(s) have been pending for >${maxCycles} cycles:`,
    ``,
  ];

  for (const item of staleItems) {
    lines.push(`- **${item.dept}**: ${item.file} (${item.age} old)`);
  }

  lines.push(``, `Action required: review and resolve or delegate.`);
  writeFileSync(escalationPath, lines.join("\n"));
  console.log(`📨 Escalation sent to CEO inbox: ${basename(escalationPath)}`);
  console.log(`   ${staleItems.length} stale item(s) reported.`);
} else {
  console.error(`Error: unknown action '${action}'. Use 'scan' or 'escalate'.`);
  process.exit(1);
}
