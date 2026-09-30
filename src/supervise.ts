/**
 * Driving the supervisor inside a running container.
 *
 * `docker exec` rather than an entrypoint-spawned process, so a crashed
 * supervisor surfaces as a failed exec instead of a container that quietly
 * restarts in a loop.
 */

import type { Config } from "./config";
import { RuntimeFailure } from "./errors";
import { containerNameForFile, defaultRunner, type Runner } from "./docker";

/** The supervisor entrypoint inside the image. */
export const SUPERVISOR_ENTRY = "/usr/local/bin/supervisor";

// Delegates, rather than re-deriving from the basename. It used to, which is
// how the CLI and docker.ts ended up computing two different names for the
// same workspace - the class of bug this whole change exists to remove.
export function containerNameFor(config: Config): string {
  return containerNameForFile(config.workspaceFile);
}

export interface SupervisorResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly lines: readonly string[];
}

/**
 * Run the supervisor inside the container.
 *
 * The supervisor blocks, so this is given an explicit timeout and a stop
 * signal. The default here is short: the point is to prove the schedule
 * registers, not to babysit a long-lived process from a synchronous CLI.
 */
export async function runSupervisor(
  config: Config,
  container: string,
  options: { readonly timeoutMs?: number; readonly runner?: Runner; readonly timezone?: string } = {},
): Promise<SupervisorResult> {
  const timezone = options.timezone ?? "UTC";
  const runner = options.runner ?? defaultRunner;
  const timeoutMs = options.timeoutMs ?? 10_000;
  try {
    const result = await runner(
      "docker",
      [
        "exec",
        "--workdir",
        "/work",
        "-e",
        `COD_WORKSPACE_FILE=/cod/cod.json`,
        // Before the container name: after it, Docker treats it as an argument
        // to the command rather than an exec option.
        "-e",
        `TZ=${timezone}`,
        container,
        // The wrapper is a shell script, so it must be EXECUTED, not handed to
        // `bun run` - which tries to parse it as JavaScript and dies with a
        // syntax error pointing at the word "bun" on the shebang line.
        SUPERVISOR_ENTRY,
      ],
      timeoutMs,
    );
    const lines = `${result.stdout}\n${result.stderr}`
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    return { code: result.code, stdout: result.stdout, stderr: result.stderr, lines };
  } catch (error) {
    throw new RuntimeFailure(
      `could not run the supervisor in ${container}: ${(error as Error).message}`,
    );
  }
}
