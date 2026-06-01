#!/usr/bin/env bun
// pivot.ts — Pivot gate management
import { parseProjectPath, getArg, hasFlag, readState, writeState, isoNow } from "./lib/utils.ts";

const GATES = ["gate-1", "gate-2", "gate-3", "gate-4", "gate-5"];

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage:
  bun pivot.ts --path <project> --action status
  bun pivot.ts --path <project> --action advance
  bun pivot.ts --path <project> --action blocker --dept <dept> --mark|--clear`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const action = getArg(args, "--action");

if (!action) { console.error("Error: --action is required (status|advance|blocker)"); process.exit(1); }

const state = readState(projectPath);
if (!state.pivot) {
  console.error("Error: no pivot data in state.json. Is a pivot active?");
  process.exit(1);
}

const pivot = state.pivot;

switch (action) {
  case "status": {
    console.log(`Pivot: ${pivot.name || "(unnamed)"}`);
    console.log(`  Active: ${pivot.active}`);
    console.log(`  Type: ${pivot.type || "n/a"}`);
    console.log(`  Phase: ${pivot.phase || "n/a"}`);
    console.log(`  Execution phase: ${pivot.executionPhase || "n/a"}`);
    if (pivot.frozenDepartments?.length) {
      console.log(`  Frozen departments: ${pivot.frozenDepartments.join(", ")}`);
    }
    // Show blockers
    const blockers = pivot.tracking?.blockers || [];
    if (blockers.length) {
      console.log(`  Blockers (${blockers.length}):`);
      for (const b of blockers) console.log(`    - ${b.dept}: ${b.reason || "no reason"} (${b.addedAt || "?"})`);
    } else {
      console.log(`  Blockers: none`);
    }
    // Show gate progress
    if (pivot.tracking?.gateHistory?.length) {
      console.log(`  Gate history:`);
      for (const g of pivot.tracking.gateHistory) console.log(`    ${g.gate} — ${g.advancedAt}`);
    }
    break;
  }
  case "advance": {
    const currentGate = pivot.executionPhase || pivot.phase || "gate-1";
    const idx = GATES.indexOf(currentGate);
    // Check for blockers
    const blockers = pivot.tracking?.blockers || [];
    const activeBlockers = blockers.filter((b: any) => !b.cleared);
    if (activeBlockers.length) {
      console.error(`Cannot advance: ${activeBlockers.length} active blocker(s):`);
      for (const b of activeBlockers) console.error(`  - ${b.dept}: ${b.reason || "no reason"}`);
      process.exit(1);
    }
    if (idx < 0 || idx >= GATES.length - 1) {
      console.error(`Cannot advance beyond ${currentGate}`);
      process.exit(1);
    }
    const nextGate = GATES[idx + 1];
    pivot.executionPhase = nextGate;
    if (!pivot.tracking) pivot.tracking = {};
    if (!pivot.tracking.gateHistory) pivot.tracking.gateHistory = [];
    pivot.tracking.gateHistory.push({ gate: nextGate, advancedAt: isoNow(), from: currentGate });
    writeState(projectPath, state);
    console.log(`✓ Pivot advanced: ${currentGate} → ${nextGate}`);
    break;
  }
  case "blocker": {
    const dept = getArg(args, "--dept");
    if (!dept) { console.error("Error: --dept is required for blocker action"); process.exit(1); }
    if (!pivot.tracking) pivot.tracking = {};
    if (!pivot.tracking.blockers) pivot.tracking.blockers = [];

    if (hasFlag(args, "--mark")) {
      const reason = getArg(args, "--reason") || "";
      pivot.tracking.blockers.push({ dept, reason, addedAt: isoNow(), cleared: false });
      writeState(projectPath, state);
      console.log(`✓ ${dept} marked as blocker${reason ? `: ${reason}` : ""}`);
    } else if (hasFlag(args, "--clear")) {
      let found = false;
      for (const b of pivot.tracking.blockers) {
        if (b.dept === dept && !b.cleared) { b.cleared = true; b.clearedAt = isoNow(); found = true; }
      }
      if (!found) { console.error(`No active blocker found for '${dept}'`); process.exit(1); }
      writeState(projectPath, state);
      console.log(`✓ Blocker cleared for ${dept}`);
    } else {
      console.error("Error: specify --mark or --clear"); process.exit(1);
    }
    break;
  }
  default:
    console.error(`Error: unknown action '${action}'. Use: status|advance|blocker`);
    process.exit(1);
}
