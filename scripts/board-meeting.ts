#!/usr/bin/env bun
// board-meeting.ts — Run a board meeting, collect summaries, write minutes
import { writeFileSync } from "fs";
import { join } from "path";
import { parseProjectPath, hasFlag, readState, writeState, listDepartments, getDeptDir, listMdFiles, ensureDir, fileTimestamp, isoNow, parseSince } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun board-meeting.ts --path <project>`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const state = readState(projectPath);
const lastMeeting = state.lastBoardMeeting ? new Date(state.lastBoardMeeting) : new Date(0);
const depts = listDepartments(projectPath);

// Activity since last meeting
const activity = (state.recentChanges || [])
  .filter((e: any) => new Date(e.ts) > lastMeeting)
  .map((e: any) => `- [${e.ts}] **${e.dept}**: ${e.action}`)
  .join("\n") || "- No activity since last meeting";

// Per-department status
const deptStatus = depts.map(d => {
  const grade = state.departmentGrades?.[d] || "ungraded";
  const pending = listMdFiles(join(getDeptDir(projectPath, d), "inbox")).length;
  const done = listMdFiles(join(getDeptDir(projectPath, d), "inbox", "done")).length;
  const artifactDirs = ["specs", "prototypes", "designs", "runbooks", "audits", "research", "reviews"];
  const artifacts = artifactDirs.reduce((sum, sub) => sum + listMdFiles(join(getDeptDir(projectPath, d), sub)).length, 0);
  return `### ${d.toUpperCase()}\n- Grade: ${grade}\n- Inbox: ${pending} pending, ${done} done\n- Artifacts: ${artifacts} files`;
}).join("\n\n");

// Pipeline
const pipeline = Object.entries(state.pipeline || {})
  .map(([k, v]) => `- ${k}: ${(v as string[]).length} items`)
  .join("\n") || "- No pipeline data";

// Escalations & Blocked
const escalations = (state.pendingEscalations || []).map((e: any) => `- ${JSON.stringify(e)}`).join("\n") || "- None";
const blocked = (state.blockedTasks || []).map((t: any) => `- ${JSON.stringify(t)}`).join("\n") || "- None";

// Auto-generate agenda items
const agendaItems: string[] = [];
if ((state.pendingEscalations || []).length) agendaItems.push("- Review and resolve pending escalations");
if ((state.blockedTasks || []).length) agendaItems.push("- Unblock stalled tasks");
for (const d of depts) {
  const g = state.departmentGrades?.[d];
  if (g === "D" || g === "F") agendaItems.push(`- Address poor performance: ${d.toUpperCase()} (grade ${g})`);
}
if (!agendaItems.length) agendaItems.push("- No urgent agenda items");

const minutes = `# Board Meeting — ${new Date().toISOString().slice(0, 10)}

## Activity Since Last Meeting
${activity}

## Department Status
${deptStatus}

## Pipeline
${pipeline}

## Escalations & Blocked
### Escalations
${escalations}

### Blocked Tasks
${blocked}

## Agenda Items
${agendaItems.join("\n")}
`;

const boardDir = join(getDeptDir(projectPath, "board"), "minutes");
ensureDir(boardDir);
const minutesPath = join(boardDir, `${fileTimestamp()}-board-meeting.md`);
writeFileSync(minutesPath, minutes);

state.lastBoardMeeting = isoNow();
writeState(projectPath, state);

console.log(`Board meeting minutes: ${minutesPath}`);
