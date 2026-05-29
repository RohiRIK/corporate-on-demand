#!/usr/bin/env bun
// activity-log.ts — Append/query the activity log
import { parseProjectPath, getArg, getArgList, hasFlag, readState, writeState, isoNow, parseSince } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage:
  bun activity-log.ts --path <project> --append --dept <dept> --action "description"
  bun activity-log.ts --path <project> --query [--since 12h] [--dept rnd,infra]`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);

if (hasFlag(args, "--append")) {
  const dept = getArg(args, "--dept");
  const action = getArg(args, "--action");
  if (!dept || !action) { console.error("Error: --dept and --action required for --append"); process.exit(1); }
  const state = readState(projectPath);
  if (!state.recentChanges) state.recentChanges = [];
  state.recentChanges.push({ dept, action, ts: isoNow() });
  writeState(projectPath, state);
  console.log(`Logged: [${dept}] ${action}`);
} else if (hasFlag(args, "--query")) {
  const since = getArg(args, "--since");
  const depts = getArgList(args, "--dept");
  const sinceDate = since ? parseSince(since) : new Date(0);
  const state = readState(projectPath);
  const entries = (state.recentChanges || [])
    .filter((e: any) => new Date(e.ts) >= sinceDate)
    .filter((e: any) => !depts.length || depts.includes(e.dept));
  for (const e of entries) {
    console.log(`[${e.ts}] ${e.dept}: ${e.action}`);
  }
  console.log(`\n${entries.length} entries`);
} else {
  console.error("Error: specify --append or --query");
  process.exit(1);
}
