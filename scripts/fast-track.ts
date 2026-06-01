#!/usr/bin/env bun
// fast-track.ts — Fast-track lifecycle management
import { parseProjectPath, getArg, hasFlag, readState, writeState, isoNow } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage:
  bun fast-track.ts --path <project> --action issue --dept <dept> --item <item> --cycles <n>
  bun fast-track.ts --path <project> --action status
  bun fast-track.ts --path <project> --action expire --dept <dept>
  bun fast-track.ts --path <project> --action auto-check`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const action = getArg(args, "--action");

if (!action) { console.error("Error: --action is required (issue|status|expire|auto-check)"); process.exit(1); }

const state = readState(projectPath);
if (!state.fastTrack) state.fastTrack = [];

switch (action) {
  case "issue": {
    const dept = getArg(args, "--dept");
    const item = getArg(args, "--item");
    const cycles = parseInt(getArg(args, "--cycles") || "3");
    if (!dept || !item) { console.error("Error: --dept and --item are required for issue"); process.exit(1); }

    const entry = {
      dept,
      item,
      maxCycles: cycles,
      usedCycles: 0,
      issuedAt: isoNow(),
      expiresAfterCycle: cycles,
      expired: false,
    };
    state.fastTrack.push(entry);
    writeState(projectPath, state);
    console.log(`✓ Fast-track issued`);
    console.log(`  Department: ${dept}`);
    console.log(`  Item: ${item}`);
    console.log(`  Max cycles: ${cycles}`);
    break;
  }
  case "status": {
    const tracks = state.fastTrack;
    if (!tracks.length) { console.log("No active fast-tracks."); break; }
    console.log(`Fast-tracks (${tracks.length}):`);
    for (const t of tracks) {
      const status = t.expired ? "EXPIRED" : `${t.usedCycles}/${t.maxCycles} cycles`;
      console.log(`  [${status}] ${t.dept} — ${t.item} (issued ${t.issuedAt})`);
    }
    break;
  }
  case "expire": {
    const dept = getArg(args, "--dept");
    if (!dept) { console.error("Error: --dept is required for expire"); process.exit(1); }
    let found = false;
    for (const t of state.fastTrack) {
      if (t.dept === dept && !t.expired) { t.expired = true; t.expiredAt = isoNow(); found = true; }
    }
    if (!found) { console.error(`No active fast-track found for dept '${dept}'`); process.exit(1); }
    writeState(projectPath, state);
    console.log(`✓ Fast-track expired for ${dept}`);
    break;
  }
  case "auto-check": {
    let expiredCount = 0;
    for (const t of state.fastTrack) {
      if (!t.expired && t.usedCycles >= t.maxCycles) {
        t.expired = true;
        t.expiredAt = isoNow();
        expiredCount++;
        console.log(`  Auto-expired: ${t.dept} — ${t.item} (${t.usedCycles}/${t.maxCycles})`);
      }
    }
    if (expiredCount > 0) {
      writeState(projectPath, state);
      console.log(`✓ ${expiredCount} fast-track(s) auto-expired`);
    } else {
      console.log("No fast-tracks exceeded their cycle limit.");
    }
    break;
  }
  default:
    console.error(`Error: unknown action '${action}'. Use: issue|status|expire|auto-check`);
    process.exit(1);
}
