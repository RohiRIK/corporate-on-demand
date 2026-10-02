/**
 * The container name for a workspace, for the commands that need it.
 *
 * This file used to drive a SECOND supervisor into a running container with
 * `docker exec`, for `cod supervise`. An exec'd process outlives the client that
 * started it, so that second supervisor stayed, and every cron fired twice. The
 * supervisor is the container's PID 1 now and refuses to run as anything else;
 * `cod supervise` reads its heartbeat instead.
 */

import type { Config } from "./config";
import { containerNameForFile } from "./docker";

// Delegates, rather than re-deriving from the basename. It used to, which is
// how the CLI and docker.ts ended up computing two different names for the
// same workspace - the class of bug this whole change exists to remove.
export function containerNameFor(config: Config): string {
  return containerNameForFile(config.workspaceFile);
}
