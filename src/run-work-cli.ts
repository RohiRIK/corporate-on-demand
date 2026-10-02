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

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chooseSandbox, jobPolicy } from "./sandbox";
import { Workspace } from "./workspace";
import { openWork, get, latestReview } from "./work";
import { runWorkItem, briefFor, radiusForWork, targetPathsOfItem } from "./runwork";
import { resolveTarget } from "./assign";
import { dispatch } from "./dispatch";
import { driverFor } from "./drivers";
import { acquireWorktree, releaseWorktree } from "./worktree";
import { buildInstructions, writeInstructions, resolveSkillsRoot } from "./skills";


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

// WHO runs it. The item is addressed to a department; a worker runs it, and
// this lookup used to search for a WORKER by a DEPARTMENT's name, always miss,
// and then silently skip writing the instructions. See src/assign.ts.
const target = resolveTarget(workspace, item.to_agent);
if (target.worker === undefined) {
  // A named failure. Running the agent anyway - with no purpose, no rules and
  // no radius - is the worst outcome available, so it is refused.
  process.stderr.write(`${workId} REFUSED: ${target.reason ?? "no worker could be resolved"}\n`);
  process.exit(3);
}
if (target.note !== undefined) process.stderr.write(`${target.note}\n`);
const worker = target.worker;
const department = target.department;
// The TEXT, not the JSON wrapper - plus every objection a reviewer has made so
// far, read from the review row. The paths are bookkeeping; handing them to the
// model as part of its instruction is the system showing its plumbing to the
// thing it is directing.
const goal = briefFor(item, latestReview(handle, workId));
const cron = {
  name: item.id,
  // The WORKER, not the addressee - so the log and the result line name who
  // actually did the work rather than which department asked for it.
  agent: worker.name,
  task: goal,
  schedule: "0 0 1 1 *",
  enabled: true,
  // Strict for a task: it is expected to change something. A PLAN only reads,
  // and its product is the task it proposes, so no tool call is demanded.
  expectTools: item.kind !== "plan",
};

const worktree = acquireWorktree(workRoot, worktreeRoot, item.id);
try {
  // Unconditional now. The old `if (worker && department)` guard is what let a
  // missing instruction file pass as a successful run.
  if (department === undefined) throw new Error(`resolved worker ${worker.name} has no department`);
  const radius = radiusForWork(item.payload, targetPathsOfItem(item), item.blast_radius);
  const instructionsPath = writeInstructions(
    worktree.path,
    buildInstructions(department, worker, { name: item.id, task: goal }, radius, resolveSkillsRoot()),
  );
  // Verified, not assumed. The whole bug was a file that was never written and
  // nothing that noticed.
  if (!existsSync(instructionsPath)) {
    throw new Error(`instructions were not written to ${instructionsPath}`);
  }
  // The same sandbox the supervisor gives a dispatched item: a plan reads, a
  // task writes its own worktree. Required unless cod.json says "off".
  try {
    mkdirSync(join(workRoot, ".git", "logs", "refs", "heads", "cod"), { recursive: true });
  } catch {
    // No reflogs is fine; the sandbox skips a rule for a path that is not there.
  }
  const sandbox = {
    choice: chooseSandbox(workspace.agentSandbox, process.env["COD_SANDBOX"], existsSync),
    policy: jobPolicy({ repo: workRoot, worktree: worktree.path, job: item.id, home: homedir(), mode: item.kind === "plan" ? "read" : "write" }),
  };
  const result = await runWorkItem({
    stateDir,
    workId,
    cron,
    driver: driverFor(worker ?? null, workspace.company, { workdir: worktree.path, sandbox }),
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
