#!/usr/bin/env bun
// inbox-digest.ts — Read & summarize a department's inbox
import { readFileSync } from "fs";
import { join } from "path";
import { parseProjectPath, getArg, hasFlag, getDeptDir, listMdFiles, parseSince } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun inbox-digest.ts --path <project> --dept <dept> [--status pending|done|all] [--since 24h]`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const dept = getArg(args, "--dept");
if (!dept) { console.error("Error: --dept is required"); process.exit(1); }

const status = getArg(args, "--status") || "pending";
const since = getArg(args, "--since");
const sinceDate = since ? parseSince(since) : new Date(0);
const deptDir = getDeptDir(projectPath, dept);

function digestDir(dir: string, label: string) {
  const files = listMdFiles(dir).filter(f => f.mtime >= sinceDate);
  if (files.length === 0) return 0;
  console.log(`\n--- ${label} (${files.length}) ---`);
  for (const f of files) {
    const content = readFileSync(f.path, "utf-8");
    const lines = content.split("\n");
    const title = lines.find(l => l.startsWith("# ")) || f.name;
    const from = lines.find(l => l.startsWith("From:")) || "";
    const priority = lines.find(l => l.startsWith("Priority:")) || "";
    const date = lines.find(l => l.startsWith("Date:")) || "";
    const bodyLines = lines.slice(lines.findIndex(l => l.startsWith("## What")) + 1, lines.findIndex(l => l.startsWith("## What")) + 4).join(" ");
    console.log(`  ${title} | ${priority} | ${from} | ${date}`);
    if (bodyLines.trim()) console.log(`    ${bodyLines.trim()}`);
  }
  return files.length;
}

let pending = 0, done = 0;
if (status !== "done") pending = digestDir(join(deptDir, "inbox"), "Pending");
if (status !== "pending") done = digestDir(join(deptDir, "inbox", "done"), "Done");

console.log(`\n${dept}: ${pending} pending, ${done} done`);
