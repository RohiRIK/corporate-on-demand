/**
 * Volume purge.
 *
 * The distinction under test is the whole point: `down` KEEPS the work volume
 * so an agent's commits survive, `purge` removes it. Getting that backwards
 * either loses work on a restart or never cleans up at all.
 *
 * These tests create real volumes and delete them. A mock would not catch the
 * thing most likely to be wrong - the name Docker actually gets.
 */

import { describe, expect, test, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { purgeTarget, purgeVolume, volumeExists } from "../src/purge";
import { workVolume } from "../src/docker";

const touched: string[] = [];

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 }).trim();
}

function makeVolume(name: string): void {
  docker(["volume", "create", name]);
  touched.push(name);
}

afterEach(() => {
  for (const name of touched.splice(0)) {
    try {
      docker(["volume", "rm", "-f", name]);
    } catch {
      // Already gone; nothing to do.
    }
  }
});

describe("purgeTarget", () => {
  test("derives the same volume name the container uses", async () => {
    // If these diverged, purge would look for a volume that does not exist
    // while the real one stayed for ever.
    // Taken from workVolume rather than hardcoded, so the two cannot drift.
    // Hardcoding it is exactly the bug this test exists to catch - a mismatch
    // means purge looks for a volume that does not exist while the real one
    // stays for ever.
    expect(purgeTarget("/w/acme.json").volume).toBe(workVolume({ workspaceFile: "/w/acme.json" }));
  });

  test("reports a volume that is not there as absent", () => {
    expect(purgeTarget("/w/never-existed-xyz.json").exists).toBe(false);
  });
});

describe("purgeVolume", () => {
  test("refuses without confirmation, and says why", async () => {
    const target = purgeTarget("/w/acme.json");
    const result = await purgeVolume("/w/acme.json", { confirmed: false });
    expect(result.removed).toBe(false);
    expect(result.reason).toContain("--purge");
    expect(result.volume).toBe(target.volume);
  });

  test("removes the volume when confirmed", async () => {
    const target = purgeTarget("/w/acme.json").volume;
    makeVolume(target);
    expect(volumeExists("/w/acme.json")).toBe(true);
    const result = await purgeVolume("/w/acme.json", { confirmed: true });
    expect(result.removed).toBe(true);
    expect(volumeExists("/w/acme.json")).toBe(false);
  });

  test("stops the container first, or Docker refuses with 'volume is in use'", async () => {
    // The ordinary case: the container is up, because that is WHY the volume
    // exists. Measured: purge failed with "volume is in use" until the stop
    // was added - the exact case it exists to handle.
    const target = purgeTarget("/w/acme.json").volume;
    makeVolume(target);
    let stopped = false;
    const result = await purgeVolume("/w/acme.json", {
      confirmed: true,
      stop: (): boolean => {
        stopped = true;
        return true;
      },
    });
    expect(stopped).toBe(true);
    expect(result.removed).toBe(true);
    expect(result.stopped).toBe(true);
  });

  test("reports a missing volume rather than failing", async () => {
    // Purging something already gone is the common case when cleaning up.
    const result = await purgeVolume("/w/never-existed-xyz.json", { confirmed: true });
    expect(result.removed).toBe(false);
    expect(result.reason).toContain("no such volume");
  });

  test("the name is derived, never taken from the caller", async () => {
    // There is no parameter through which a caller could name another volume,
    // so this cannot be turned into "delete an arbitrary volume".
    makeVolume(purgeTarget("/w/acme.json").volume);
    // Awaited: it is async, and the check below passed only because nothing in
    // it happens to yield before the docker call today.
    await purgeVolume("/w/acme.json", { confirmed: true });
    expect(volumeExists("/w/acme.json")).toBe(false);
  });

  test("one workspace's purge leaves another's alone", async () => {
    const a = purgeTarget("/w/a.json").volume;
    const b = purgeTarget("/w/b.json").volume;
    makeVolume(a);
    makeVolume(b);
    await purgeVolume("/w/a.json", { confirmed: true });
    expect(volumeExists("/w/a.json")).toBe(false);
    expect(volumeExists("/w/b.json")).toBe(true);
  });
});
