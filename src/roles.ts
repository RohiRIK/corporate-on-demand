/**
 * Read-only roles: the reviewer, and the meeting's voices.
 *
 * Both are model calls through the same engine as a worker, and the engines run
 * with tool use (`--auto`). They used to run with their working directory set to
 * `/work` - the main checkout, the one place in the system that MERGES. A
 * reviewer that "inspected" the branch by checking it out moved `/work`'s HEAD,
 * and the next merge landed on that branch instead of the base; a meeting voice
 * that ran the tests left files in the tree the merge then tripped over.
 *
 * Neither role needs the repository: the reviewer is handed the diff, the voice
 * is handed the ledger. So each call gets a throwaway directory of its own, with
 * an AGENTS.md that says what the role is, and the directory is removed after.
 * Under the agent sandbox (src/sandbox.ts) that directory is the only place the
 * role may write at all.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Cron } from "./workspace";

export type RoleName = "reviewer" | "meeting";

/** What each role is told in its AGENTS.md. Kept as data so a test can read it. */
export const ROLE_BRIEFS: Readonly<Record<RoleName, string>> = {
  reviewer: [
    "# REVIEWER",
    "",
    "You review ONE change. Everything you need is in the prompt: the task, the",
    "paths it named, the paths it touched, and the diff.",
    "",
    "- Do not run commands, check out branches, or change any file.",
    "- Answer with exactly one of: approve, request changes, reject - then one",
    "  sentence saying why.",
  ].join("\n"),
  meeting: [
    "# COMPANY MEETING",
    "",
    "You state one role's position in a company meeting, in at most three",
    "sentences. Everything you need is in the prompt.",
    "",
    "- Do not run commands or change any file. Nobody is reading this live.",
  ].join("\n"),
};

/** The runner a role call goes through. Injected so it is testable without a model. */
export type RoleRunner = (cron: Cron, workdir: string) => Promise<string>;

/**
 * Ask a read-only role, in a directory of its own.
 *
 * Never throws for a runner failure: the runner's own contract is to report one
 * as text, and the scratch directory is removed whatever happened.
 */
export async function askRole(role: RoleName, name: string, prompt: string, run: RoleRunner): Promise<string> {
  const scratch = mkdtempSync(join(tmpdir(), `cod-${role}-`));
  try {
    writeFileSync(join(scratch, "AGENTS.md"), `${ROLE_BRIEFS[role]}\n`, "utf8");
    return await run(
      { name, agent: role, task: prompt, schedule: "0 0 1 1 *", enabled: true, expectTools: false },
      scratch,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
