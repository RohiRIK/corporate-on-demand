#!/usr/bin/env bun
// sprint.ts — Sprint mode activation/deactivation
import { parseProjectPath, getArg, getArgList, hasFlag, readState, writeState, isoNow } from "./lib/utils.ts";

const LEVERS: Record<number, string> = {
  1: "Shorten cron intervals (2× frequency)",
  2: "Expand data-collection scope",
  3: "Auto-wake blocked departments",
  4: "Fast-track all pending items",
  5: "Priority-escalate inbox messages",
  6: "Freeze non-critical departments",
};

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage:
  bun sprint.ts --path <project> --action activate --levers 1,4,6 --reason '...'
  bun sprint.ts --path <project> --action status
  bun sprint.ts --path <project> --action deactivate

Levers:
${Object.entries(LEVERS).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const action = getArg(args, "--action");

if (!action) { console.error("Error: --action is required (activate|status|deactivate)"); process.exit(1); }

const state = readState(projectPath);

switch (action) {
  case "activate": {
    const leverStrs = getArgList(args, "--levers");
    const reason = getArg(args, "--reason");
    if (!leverStrs.length) { console.error("Error: --levers is required (e.g. 1,4,6)"); process.exit(1); }
    if (!reason) { console.error("Error: --reason is required"); process.exit(1); }

    const leverNums = leverStrs.map(Number);
    const invalid = leverNums.filter(n => !LEVERS[n]);
    if (invalid.length) { console.error(`Error: invalid lever(s): ${invalid.join(", ")}. Valid: 1-6`); process.exit(1); }

    state.sprintMode = {
      active: true,
      activatedAt: isoNow(),
      reason,
      levers: leverNums.map(n => ({ id: n, name: LEVERS[n], enabled: true })),
    };
    writeState(projectPath, state);
    console.log(`✓ Sprint mode ACTIVATED`);
    console.log(`  Reason: ${reason}`);
    console.log(`  Levers:`);
    for (const n of leverNums) console.log(`    [${n}] ${LEVERS[n]}`);
    break;
  }
  case "status": {
    const sm = state.sprintMode;
    if (!sm || !sm.active) { console.log("Sprint mode: INACTIVE"); break; }
    console.log(`Sprint mode: ACTIVE (since ${sm.activatedAt})`);
    console.log(`  Reason: ${sm.reason}`);
    console.log(`  Levers:`);
    for (const l of sm.levers) console.log(`    [${l.id}] ${l.name} — ${l.enabled ? "ON" : "OFF"}`);
    break;
  }
  case "deactivate": {
    if (!state.sprintMode?.active) { console.log("Sprint mode already inactive."); break; }
    state.sprintMode.active = false;
    state.sprintMode.deactivatedAt = isoNow();
    writeState(projectPath, state);
    console.log(`✓ Sprint mode DEACTIVATED`);
    break;
  }
  default:
    console.error(`Error: unknown action '${action}'. Use: activate|status|deactivate`);
    process.exit(1);
}
