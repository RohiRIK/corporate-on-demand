/**
 * Volume cleanup.
 *
 * `cod down` deliberately KEEPS the work volume, because its whole purpose is
 * to survive a container restart: an agent's committed work must outlive the
 * container that produced it. That makes `down` the wrong tool for cleaning up,
 * and leaves a gap - volumes accumulate one per workspace for ever.
 *
 * `purge` is that counterpart, and it is destructive by design. It requires an
 * explicit confirmation flag, and it reports exactly what it removed, because
 * the difference between "down" and "purge" is the difference between closing a
 * laptop and throwing it away.
 */

import { execFileSync } from "node:child_process";
import { RuntimeFailure } from "./errors";
import { workVolume } from "./docker";

export interface PurgeTarget {
  readonly volume: string;
  readonly exists: boolean;
}

function dockerVolume(args: readonly string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync("docker", [...args], { encoding: "utf8", timeout: 60_000 }).trim();
    return { ok: true, out };
  } catch (error) {
    return { ok: false, out: (error as Error).message };
  }
}

/** The volume this workspace would use, and whether it currently exists. */
export function purgeTarget(workspaceFile: string): PurgeTarget {
  const volume = workVolume({ workspaceFile });
  const listed = dockerVolume(["volume", "ls", "-q", "--filter", `name=^${volume}$`]);
  return { volume, exists: listed.ok && listed.out === volume };
}

/**
 * Remove a workspace's work volume, stopping the container first if needed.
 *
 * The name is derived, never accepted from the caller, so this cannot be turned
 * into "delete an arbitrary volume". Refused without `confirmed`.
 *
 * The container is stopped first because Docker refuses to remove a volume that
 * is still in use - and the container is almost always still up, since the
 * point of the volume is that `down` keeps it. Without this, `purge` failed with
 * "volume is in use" in the ordinary case, which is the case it exists for.
 */
export async function purgeVolume(
  workspaceFile: string,
  options: { readonly confirmed?: boolean; readonly stop?: (workspaceFile: string) => boolean | Promise<boolean> } = {},
): Promise<{ readonly volume: string; readonly removed: boolean; readonly reason?: string; readonly stopped?: boolean }> {
  const target = purgeTarget(workspaceFile);
  if (options.confirmed !== true) {
    return {
      volume: target.volume,
      removed: false,
      reason: "not confirmed; pass --purge to remove the volume and everything committed in it",
    };
  }
  if (!target.exists) {
    return { volume: target.volume, removed: false, reason: "no such volume" };
  }

  const stopped = options.stop === undefined ? false : await options.stop(workspaceFile);
  const removed = dockerVolume(["volume", "rm", "-f", target.volume]);
  if (!removed.ok) {
    throw new RuntimeFailure(
      `could not remove ${target.volume}: ${removed.out}\n` +
        "Stop the container first with `cod down` if it is still running.",
    );
  }
  return { volume: target.volume, removed: true, ...(stopped ? { stopped: true } : {}) };
}

/** Whether a workspace's work volume currently exists, for `cod status`. */
export function volumeExists(workspaceFile: string): boolean {
  return purgeTarget(workspaceFile).exists;
}
