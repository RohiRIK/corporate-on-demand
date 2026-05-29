#!/usr/bin/env bun
// read-artifacts.ts — Scan & summarize artifacts from departments
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { parseProjectPath, getArg, getArgList, hasFlag, listDepartments, getDeptDir, parseSince, truncate, listMdFiles } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun read-artifacts.ts --path <project> [--dept rnd,infra] [--since 24h] [--format summary|full|count]`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const depts = getArgList(args, "--dept");
const since = getArg(args, "--since");
const format = getArg(args, "--format") || "summary";
const sinceDate = since ? parseSince(since) : new Date(0);
const targetDepts = depts.length ? depts : listDepartments(projectPath);

for (const dept of targetDepts) {
  const deptDir = getDeptDir(projectPath, dept);
  if (!existsSync(deptDir)) { console.error(`Warning: department '${dept}' not found`); continue; }
  console.log(`\n=== ${dept.toUpperCase()} ===`);
  const subdirs = readdirSync(deptDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== "inbox")
    .map(d => d.name);

  for (const sub of subdirs) {
    const files = listMdFiles(join(deptDir, sub)).filter(f => f.mtime >= sinceDate);
    if (files.length === 0) continue;

    if (format === "count") {
      console.log(`  ${sub}/: ${files.length} files`);
    } else {
      console.log(`  --- ${sub}/ ---`);
      for (const f of files) {
        if (format === "full") {
          console.log(`  [${f.name}] (${f.mtime.toISOString()})`);
          console.log(readFileSync(f.path, "utf-8"));
        } else {
          const lines = readFileSync(f.path, "utf-8").split("\n").slice(0, 2).join(" ");
          console.log(`  ${f.name} (${f.mtime.toISOString()}) — ${truncate(lines)}`);
        }
      }
    }
  }
}
