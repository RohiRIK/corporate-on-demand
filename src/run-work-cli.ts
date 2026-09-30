/**
 * Run one ledger item as a real job, INSIDE the container.
 *
 * This is the in-container half of `cod work run`. It lives here rather than in
 * the CLI because the ledger and the /work volume are the container's, and the
 * host has neither - a host-side dispatch fails with "no git repository at
 * /work", which is true and useless. The host hands the work over; this file
 * does it.
 *
 * Same guarantees as a cron job, deliberately: the same worktree, the same
 * instruction bundle, the same agent driver. A job run from the ledger and a
 * job run from cron must not be two different machines.
 *
 *   run-work-cli <work-id> [--workspace /cod/cod.json] [--state /cod]
 *
 * Exits 0 when the item ran and committed, 3 when it was refused, 4 on failure.
 * Distinct codes because a refusal and a failure are different events and the
 * operator's runbook treats them differently.
 */

import { readFileSync } from "node:fs";
import { Workspace } from "./workspace";
import { openWork, get } from "./work";
import { runWorkItem, textOfItem } from "./runwork";
import { dispatch } from "./dispatch";
import { driverFor } from "./drivers";
import { acquireWorktree, releaseWorktree } from "./worktree";
import { buildInstructions, writeInstructions, SKILLS_DIR } from "./skills";


const args = process.argv.slice(2);
const workId = args.find((a) => !a.startsWith("-")) ?? "";
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : fallback;
};

const workspaceFile = flag("workspace", "/cod/cod.json");
const stateDir = flag("state", "/cod");
const workRoot = flag("work", "/work");
const worktreeRoot = flag("worktrees", "/work/.cod-worktrees");

if (workId === "") {
  process.stderr.write("usage: run-work-cli <work-id> [--workspace f] [--state d]\n");
  process.exit(2);
}

let workspace: Workspace;
try {
  workspace = Workspace.parse(JSON.parse(readFileSync(workspaceFile, "utf8")) as unknown);
} catch (error) {
  process.stderr.write(`cannot read ${workspaceFile}: ${(error as Error).message}\n`);
  process.exit(2);
}
const handle = openWork(stateDir);
const item = get(handle, workId);
if (item === null) {
  process.stderr.write(`no such work item: ${workId}\n`);
  process.exit(2);
}

const worker = workspace.departments.flatMap((d) => d.workers).find((w) => w.name === item.to_agent);
const department = workspace.departments.find((d) => d.workers.some((w) => w.name === item.to_agent));
// The TEXT, not the JSON wrapper. The paths are bookkeeping; handing them to
// the model as part of its instruction is the system showing its plumbing to
// the thing it is directing.
const goal = textOfItem(item);
const cron: { name: string; agent: string; task: string; schedule: string; enabled: boolean } = {
  name: item.id,
  agent: item.to_agent,
  task: goal,
  schedule: "0 0 1 1 *",
  enabled: true,
};

const worktree = acquireWorktree(workRoot, worktreeRoot, item.id);
try {
  if (worker !== undefined && department !== undefined) {
    writeInstructions(worktree.path, buildInstructions(department, worker, { name: item.id, task: goal }, 0, SKILLS_DIR));
  }
  const result = await runWorkItem({
    stateDir,
    workId,
    cron,
    driver: driverFor(worker ?? null, workspace.company, { workdir: worktree.path }),
  });
  void dispatch;
  if (result.ok) {
    process.stdout.write(`ran ${workId} (radius ${result.radius ?? "?"}): ${(result.output ?? "").slice(0, 400)}\n`);
    process.exit(0);
  }
  const refused = /only the CEO may dispatch/.test(result.reason ?? "");
  process.stderr.write(`${workId} ${refused ? "REFUSED" : "FAILED"}: ${result.reason ?? "unknown"}\n`);
  process.exit(refused ? 3 : 4);
} finally {
  // The BRANCH and its commits stay in /work. Only the worktree directory goes.
  releaseWorktree(workRoot, worktree);
  handle.close();
}
