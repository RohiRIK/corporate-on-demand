/**
 * The state directory is the container's one writable bind mount, and a bind
 * mount carries the HOST's ownership in.
 *
 * Found by running the clean room as root: `cod init` created the state
 * directory root-owned, the container runs as uid 1000, the supervisor died on
 * its first `mkdir /cod/logs`, and `cod up` said only "the supervisor is not
 * live (never)". Any host user who is not uid 1000 got the same.
 *
 * Three fixes, one test group each:
 *   - a root `cod` gives a directory it CREATES to the container's uid, and
 *     leaves an existing one alone;
 *   - the entrypoint checks, as the uid that matters, and says so in a FATAL
 *     line;
 *   - `cod up` repeats that line, with the host path and the command.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supervisorDownMessage } from "../src/commands";
import { CONTAINER_GID, CONTAINER_UID, makeContainerDir } from "../src/config";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-stateowner-"));
  chmodSync(dir, 0o755);
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const isRoot = process.platform === "linux" && process.getuid?.() === 0;
const ENTRYPOINT = join(import.meta.dir, "..", "docker", "entrypoint.sh");

describe("a directory cod creates belongs to the container's uid", () => {
  test("a NEW state directory is the container's when root creates it, the caller's otherwise", () => {
    const state = join(scratch(), "state");
    makeContainerDir(state);
    const expected = isRoot ? CONTAINER_UID : process.getuid?.();
    expect(statSync(state).uid).toBe(expected!);
    if (isRoot) expect(statSync(state).gid).toBe(CONTAINER_GID);
  });

  test("an EXISTING directory is never re-owned - it is the operator's", () => {
    const state = join(scratch(), "state");
    mkdirSync(state);
    const before = statSync(state).uid;
    makeContainerDir(state);
    expect(statSync(state).uid).toBe(before);
  });

  test("only the leaf: parents created on the way are not handed over", () => {
    const base = scratch();
    makeContainerDir(join(base, "a", "b", "state"));
    expect(statSync(join(base, "a")).uid).toBe(process.getuid?.() ?? 0);
  });
});

/** Run the entrypoint as an unprivileged uid, so `[ -w ]` means something. */
function entrypointAs(uid: number, state: string): { code: number; out: string } {
  const argv = isRoot ? ["setpriv", `--reuid=${uid}`, `--regid=${uid}`, "--clear-groups", "sh", ENTRYPOINT] : ["sh", ENTRYPOINT];
  const r = spawnSync(argv[0]!, argv.slice(1), {
    encoding: "utf8",
    timeout: 30_000,
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", COD_STATE_DIR: state, COD_WORKSPACE_FILE: join(state, "absent.json") },
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe("the entrypoint checks the state directory as the uid that writes it", () => {
  const unprivileged = 65534;
  // The suite's temp directory is 0700 (tests/setup.ts), which the uid below
  // cannot even traverse. Traverse-only for the length of this group: no
  // listing, and put back afterwards.
  const runDir = tmpdir();
  let mode = 0o700;
  beforeAll(() => {
    mode = statSync(runDir).mode & 0o777;
    if (isRoot) chmodSync(runDir, mode | 0o711);
  });
  afterAll(() => {
    chmodSync(runDir, mode);
  });

  test("an unwritable state directory is a FATAL line naming it, and exit 78", () => {
    const state = join(scratch(), "state");
    mkdirSync(state);
    chmodSync(state, 0o755); // root's (or the caller's), not writable by the uid below
    if (!isRoot) chmodSync(state, 0o555);
    const r = entrypointAs(unprivileged, state);
    expect(r.code).toBe(78);
    expect(r.out).toContain("FATAL");
    expect(r.out).toContain("cannot write the state directory");
    expect(r.out).toContain(state);
  });

  test("an unwritable LEDGER inside a writable directory is caught too", () => {
    const state = join(scratch(), "state");
    mkdirSync(join(state, "work"), { recursive: true });
    chmodSync(state, 0o777);
    chmodSync(join(state, "work"), 0o755);
    if (!isRoot) chmodSync(join(state, "work"), 0o555);
    const r = entrypointAs(unprivileged, state);
    expect(r.code).toBe(78);
    expect(r.out).toContain(join(state, "work"));
  });

  test("a writable state directory passes the check (whatever happens after it)", () => {
    const state = join(scratch(), "state");
    mkdirSync(state);
    chmodSync(state, 0o777);
    const r = entrypointAs(unprivileged, state);
    expect(r.code).not.toBe(78);
    expect(r.out).not.toContain("cannot write the state directory");
  });
});

describe("cod up says why, in the container's words", () => {
  const tail = [
    "[entrypoint] workspace found at /cod/cod.json",
    "[entrypoint] FATAL: uid 1000 cannot write the state directory: /cod /cod/logs",
  ];

  test("the FATAL line is quoted, and the fix names the HOST path", () => {
    const message = supervisorDownMessage("cod-sandbox-acme", "never", "/srv/acme/state", tail);
    expect(message).toContain("FATAL: uid 1000 cannot write the state directory");
    expect(message).toContain(`sudo chown -R ${CONTAINER_UID}:${CONTAINER_GID} /srv/acme/state`);
    // The noise around it is not.
    expect(message).not.toContain("workspace found");
  });

  test("with no FATAL line, the last lines are the evidence", () => {
    const message = supervisorDownMessage("c", "stale", "/s", ["one", "two", "TypeError: boom"]);
    expect(message).toContain("TypeError: boom");
    expect(message).not.toContain("chown");
  });

  test("with no output at all, it says so and where to look", () => {
    expect(supervisorDownMessage("c", "never", "/s", [])).toContain("docker logs c");
  });
});
