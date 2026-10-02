/**
 * The operator's surface: what the CLI does with what it is given, and what it
 * says with its exit code.
 *
 * Every test here is a bug that shipped:
 *   - `--override` was parsed and then dropped, so `work unblock --override`
 *     was refused for lacking the flag it had been given;
 *   - a refused commit, proposal or unblock exited 0, so a script checking `$?`
 *     was told a fenced commit had landed;
 *   - `init --yes` overwrote an existing workspace without a word;
 *   - `--status typo`, `--level typo` and `--last abc` silently showed nothing;
 *   - two workspaces on the default state directory shared one ledger;
 *   - `cod up` could not bring back its OWN stopped container (a name conflict),
 *     so after a reboot neither it nor the systemd unit could start the
 *     workspace without a manual `cod down`;
 *   - the Docker-socket guard compared two exact strings, so a trailing slash, a
 *     symlink, or a directory CONTAINING the socket went straight through;
 *   - `cod supervise` started a second supervisor that outlived the command, so
 *     every cron fired twice;
 *   - an abandoned job was re-announced on every supervisor start, for ever.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimStateDir, OWNER_FILE } from "../src/config";
import { UsageError } from "../src/errors";
import { assertMountAllowed, makeDocker, type RunResult } from "../src/docker";
import { archiveAbandoned, beginJob, claimInflight, findAbandoned } from "../src/inflight";
import { heartbeatPath, type Heartbeat } from "../src/liveness";
import { claim, openWork, propose, recordReview } from "../src/work";
import { reconcileOnce } from "../src/reconcile";

const dirs: string[] = [];
const servers: Server[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-operator-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CLI = join(import.meta.dir, "..", "src", "index.ts");

interface Run {
  readonly out: string;
  readonly err: string;
  readonly code: number;
}

function cod(dir: string, args: readonly string[], env: Record<string, string> = {}): Run {
  const r = spawnSync(process.execPath, ["run", CLI, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    cwd: dir,
    env: { ...process.env, COD_WORKSPACE: join(dir, "cod.json"), COD_STATE_DIR: join(dir, "state"), ...env },
  });
  return { out: r.stdout ?? "", err: r.stderr ?? "", code: r.status ?? 1 };
}

function initialised(): string {
  const dir = scratch();
  const r = cod(dir, ["init", "acme", "--yes"]);
  expect(`${r.code}:${r.err}`).toBe("0:");
  return dir;
}

/** An item that the reviewer sent back, so unblocking it needs --override. */
function midRetry(dir: string): string {
  const handle = openWork(join(dir, "state"));
  try {
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "add a test", goal: "add a test" });
    if (!made.ok || made.item === undefined) throw new Error(`seed: ${made.reason}`);
    recordReview(handle, { workId: made.item.id, outcome: "changes-requested", reason: "no test was added", branch: `cod/${made.item.id}`, landedSha: "" });
    return made.item.id;
  } finally {
    handle.close();
  }
}

describe("--override reaches the command", () => {
  test("without it, unblocking a live objection is REFUSED with exit 2", () => {
    const dir = initialised();
    const id = midRetry(dir);
    const r = cod(dir, ["work", "unblock", id, "checked", "by", "hand"]);
    expect(r.code).toBe(2);
    expect(`${r.out}${r.err}`).toContain("override");
  });

  test("with it, the same unblock succeeds - the flag is no longer dropped", () => {
    const dir = initialised();
    const id = midRetry(dir);
    const r = cod(dir, ["work", "unblock", id, "checked", "by", "hand", "--override"]);
    expect(`${r.code}:${r.err}`).toBe("0:");
    expect(r.out).toContain(`cleared ${id}`);
    const handle = openWork(join(dir, "state"));
    try {
      const row = handle.db.query("SELECT outcome, reason FROM review WHERE work_id = ? ORDER BY reviewed_at DESC LIMIT 1").get(id) as { outcome: string; reason: string };
      expect(row.outcome).toBe("cleared");
      expect(row.reason.toLowerCase()).toContain("override");
    } finally {
      handle.close();
    }
  });
});

describe("a refusal is not a success", () => {
  test("a commit on work that is not running exits 2, not 0", () => {
    const dir = initialised();
    const handle = openWork(join(dir, "state"));
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "p", goal: "g" });
    handle.close();
    if (!made.ok || made.item === undefined) throw new Error("seed");
    const r = cod(dir, ["work", "commit", made.item.id, "--epoch", "0"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("REFUSED");
  });

  test("a stale epoch is refused as FENCED, with exit 2", () => {
    const dir = initialised();
    const handle = openWork(join(dir, "state"));
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "p", goal: "g" });
    reconcileOnce({ stateDir: join(dir, "state"), actor: "t", handle });
    const claimed = claim(handle, "worker");
    handle.close();
    if (!made.ok || claimed === null) throw new Error("seed");
    const r = cod(dir, ["work", "commit", claimed.id, "--epoch", String(claimed.lease_epoch - 1)]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("fenced");
  });

  test("the commit that holds the lease still exits 0", () => {
    // The other side of the line: a refusal exit must not swallow success.
    const dir = initialised();
    const handle = openWork(join(dir, "state"));
    propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "p", goal: "g" });
    reconcileOnce({ stateDir: join(dir, "state"), actor: "t", handle });
    const claimed = claim(handle, "worker");
    handle.close();
    if (claimed === null) throw new Error("seed");
    const r = cod(dir, ["work", "commit", claimed.id, "--epoch", String(claimed.lease_epoch)]);
    expect(`${r.code}:${r.err}`).toBe("0:");
  });

  test("a duplicate proposal exits 2", () => {
    const dir = initialised();
    expect(cod(dir, ["work", "propose", "--goal", "same thing"]).code).toBe(0);
    const again = cod(dir, ["work", "propose", "--goal", "same thing"]);
    expect(again.code).toBe(2);
    expect(again.out).toContain("already proposed");
  });

  test("an unblock of an unknown id exits 2", () => {
    const dir = initialised();
    expect(cod(dir, ["work", "unblock", "no-such-item"]).code).toBe(2);
  });
});

describe("init does not destroy a workspace", () => {
  test("an existing workspace file is refused, and left exactly as it was", () => {
    const dir = initialised();
    const before = readFileSync(join(dir, "cod.json"), "utf8");
    const r = cod(dir, ["init", "other", "--yes"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--force");
    expect(readFileSync(join(dir, "cod.json"), "utf8")).toBe(before);
  });

  test("--force replaces it, because sometimes that is the point", () => {
    const dir = initialised();
    const r = cod(dir, ["init", "other", "--yes", "--force"]);
    expect(`${r.code}:${r.err}`).toBe("0:");
    expect(readFileSync(join(dir, "cod.json"), "utf8")).toContain("other");
  });
});

describe("a typo in a filter is an error, not an empty answer", () => {
  test("--status must be a real state", () => {
    const dir = initialised();
    const r = cod(dir, ["work", "list", "--status", "redy"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--status must be one of");
  });

  test("a real --status is still accepted", () => {
    const dir = initialised();
    expect(cod(dir, ["work", "list", "--status", "ready"]).code).toBe(0);
  });

  test("--level must be a real level", () => {
    const dir = initialised();
    const r = cod(dir, ["logs", "--level", "warning"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--level must be one of");
  });

  test("--last must be a whole number of at least 1", () => {
    const dir = initialised();
    for (const bad of ["abc", "0", "-3", "2.5"]) {
      const r = cod(dir, ["results", "--last", bad]);
      expect(`${bad}:${r.code}`).toBe(`${bad}:2`);
      expect(r.err).toContain("--last");
    }
    expect(cod(dir, ["results", "--last", "5"]).code).toBe(0);
  });

  test("a flag the CLI does not know is a usage failure (2), not a crash (1)", () => {
    const dir = initialised();
    const r = cod(dir, ["status", "--no-such-flag"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("cod --help");
  });
});

describe("one state directory, one workspace", () => {
  test("the first workspace claims it, and the claim is a file that says so", () => {
    const state = scratch();
    claimStateDir({ stateDir: state, workspaceFile: "/srv/a/cod.json" });
    expect(JSON.parse(readFileSync(join(state, OWNER_FILE), "utf8"))).toEqual({ workspace: "/srv/a/cod.json" });
  });

  test("the same workspace may claim it again", () => {
    const state = scratch();
    claimStateDir({ stateDir: state, workspaceFile: "/srv/a/cod.json" });
    expect(() => claimStateDir({ stateDir: state, workspaceFile: "/srv/a/cod.json" })).not.toThrow();
  });

  test("ANOTHER workspace is refused, and the message names both fixes", () => {
    const state = scratch();
    claimStateDir({ stateDir: state, workspaceFile: "/srv/a/cod.json" });
    let message = "";
    try {
      claimStateDir({ stateDir: state, workspaceFile: "/srv/b/cod.json" });
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      message = (error as Error).message;
    }
    expect(message).toContain("/srv/a/cod.json");
    expect(message).toContain("--state");
    // The claim is untouched by the refusal.
    expect(readFileSync(join(state, OWNER_FILE), "utf8")).toContain("/srv/a/cod.json");
  });

  test("a damaged claim file is re-claimed rather than wedging every command", () => {
    const state = scratch();
    writeFileSync(join(state, OWNER_FILE), "{not json");
    claimStateDir({ stateDir: state, workspaceFile: "/srv/a/cod.json" });
    expect(readFileSync(join(state, OWNER_FILE), "utf8")).toContain("/srv/a/cod.json");
  });

  test("through the CLI: a second workspace on the same state dir is refused at init", () => {
    const dir = initialised();
    const r = cod(dir, ["init", "beta", "--yes", "--workspace", join(dir, "beta.json")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("belongs to another workspace");
    expect(existsSync(join(dir, "beta.json"))).toBe(false);
  });
});

describe("cod up brings back its own stopped container", () => {
  const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "", truncated: false } as unknown as RunResult);
  const missing = (): RunResult => ({ code: 1, stdout: "", stderr: "No such object", truncated: false } as unknown as RunResult);

  function fakeDocker(label: string, running: boolean) {
    const calls: string[] = [];
    let removed = false;
    const runner = async (_cmd: string, args: string[]): Promise<RunResult> => {
      calls.push(args.join(" "));
      if (args[0] === "inspect" && args.join(" ").includes("cod.workspace")) return removed ? missing() : ok(label);
      if (args[0] === "inspect") return removed ? missing() : ok(running ? "true" : "false");
      if (args[0] === "rm") removed = true;
      return ok();
    };
    return { calls, docker: makeDocker({ runner, timeoutMs: 1000 }) };
  }

  const config = { workspaceFile: "/srv/one/cod.json", stateDir: "/srv/one/state" } as never;
  const workspace = { crons: [] } as never;

  test("a STOPPED container of ours is removed and recreated, not a name conflict", async () => {
    const { calls, docker } = fakeDocker("/srv/one/cod.json", false);
    await docker.up(config, workspace);
    const rm = calls.findIndex((c) => c.startsWith("rm --force cod-"));
    const run = calls.findIndex((c) => c.startsWith("run "));
    expect(rm).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(rm);
  });

  test("a RUNNING container of ours is adopted, not replaced", async () => {
    const { calls, docker } = fakeDocker("/srv/one/cod.json", true);
    await docker.up(config, workspace);
    expect(calls.some((c) => c.startsWith("rm "))).toBe(false);
    expect(calls.some((c) => c.startsWith("run "))).toBe(false);
  });

  test("a STOPPED container of ANOTHER workspace is refused and left alone", async () => {
    const { calls, docker } = fakeDocker("/srv/two/cod.json", false);
    await expect(docker.up(config, workspace)).rejects.toThrow(/different workspace/);
    expect(calls.some((c) => c.startsWith("rm "))).toBe(false);
  });
});

describe("the runtime-socket guard", () => {
  const refused = (path: string): boolean => {
    try {
      assertMountAllowed(path);
      return false;
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      return true;
    }
  };

  async function socketAt(path: string): Promise<void> {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((done) => server.listen(path, () => done()));
  }

  test("the plain socket paths, as before", () => {
    expect(refused("/var/run/docker.sock")).toBe(true);
    expect(refused("/run/docker.sock")).toBe(true);
  });

  test("a trailing slash or a dot segment does not change what is mounted", () => {
    expect(refused("/var/run/docker.sock/")).toBe(true);
    expect(refused("/var/run/./docker.sock")).toBe(true);
    expect(refused("/var/lib/../run/docker.sock")).toBe(true);
  });

  test("other runtimes' sockets, by name, anywhere", () => {
    for (const name of ["containerd.sock", "podman.sock", "crio.sock", "buildkitd.sock"]) {
      expect(`${name}:${refused(`/somewhere/else/${name}`)}`).toBe(`${name}:true`);
    }
  });

  test("a runtime's own directory", () => {
    expect(refused("/run/containerd")).toBe(true);
    expect(refused("/var/lib/docker/volumes")).toBe(true);
  });

  test("the whole filesystem - however it is spelled", () => {
    // Asserted by the reason: on a host running Docker, "/" also CONTAINS
    // run/docker.sock, which would refuse it for the wrong reason.
    for (const root of ["/", "/tmp/..", "//"]) {
      expect(() => assertMountAllowed(root)).toThrow(/whole host filesystem/);
    }
  });

  test("a path is judged after `.` and `..` are resolved, even when it does not exist", () => {
    // /run/crio does not exist on a host without CRI-O, so there is nothing for
    // realpath to resolve: only the lexical resolution sees the runtime dir.
    expect(() => assertMountAllowed("/run/./crio/x")).toThrow(/runtime's own directory/);
  });

  test("ANY socket, whatever it is called", async () => {
    const dir = scratch();
    await socketAt(join(dir, "agent.sock"));
    expect(refused(join(dir, "agent.sock"))).toBe(true);
  });

  test("a SYMLINK to a socket is judged by what it points at", async () => {
    const dir = scratch();
    await socketAt(join(dir, "real.sock"));
    symlinkSync(join(dir, "real.sock"), join(dir, "innocent"));
    expect(refused(join(dir, "innocent"))).toBe(true);
  });

  test("a symlink to something NAMED like a runtime socket is judged by its target's name", () => {
    // Not a socket, so only the name of what the link resolves to gives it away.
    const dir = scratch();
    writeFileSync(join(dir, "docker.sock"), "");
    symlinkSync(join(dir, "docker.sock"), join(dir, "harmless"));
    expect(() => assertMountAllowed(join(dir, "harmless"))).toThrow(/runtime socket/);
  });

  test("a DIRECTORY that holds a runtime socket where runtimes put one", () => {
    // The realistic case: someone points the state directory at /var/run, or
    // at $HOME on Docker Desktop. Plain files stand in for the sockets - the
    // name, where runtimes put it, is what is checked.
    for (const where of ["", "run", ".docker/run", "docker"]) {
      const dir = scratch();
      mkdirSync(join(dir, where), { recursive: true });
      writeFileSync(join(dir, where, "docker.sock"), "");
      expect(`${where}:${refused(dir)}`).toBe(`${where}:true`);
    }
  });

  test("a relative or empty source is refused before anything else is checked", () => {
    expect(refused("state")).toBe(true);
    expect(refused("")).toBe(true);
    expect(refused(undefined as unknown as string)).toBe(true);
  });

  test("an ordinary directory, and one that does not exist yet, are allowed", () => {
    const dir = scratch();
    mkdirSync(join(dir, "state", "logs"), { recursive: true });
    expect(refused(join(dir, "state"))).toBe(false);
    expect(refused(join(dir, "not-yet"))).toBe(false);
    expect(refused(join(dir, "cod.json"))).toBe(false);
  });
});

describe("one supervisor per container", () => {
  test("the supervisor refuses to start as anything but PID 1", () => {
    const dir = scratch();
    const r = spawnSync(process.execPath, ["run", join(import.meta.dir, "..", "src", "supervisor.ts")], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, COD_LOG_DIR: join(dir, "logs"), COD_STATE_DIR: dir, COD_WORKSPACE_FILE: join(dir, "cod.json"), COD_SUPERVISOR_NOT_PID1: "" },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("PID 1");
  });

  test("`cod supervise` only READS: no container means exit 1 and nothing started", () => {
    const dir = initialised();
    const r = cod(dir, ["supervise"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("container down");
  });

  test("a fresh heartbeat does not make a stopped container look healthy", () => {
    // The heartbeat file outlives the container: it is on the host. So the
    // container's own state is checked too, not inferred from the file.
    const dir = initialised();
    const beat: Heartbeat = { runId: "r", startedAt: Date.now(), seenAt: Date.now(), jobs: ["nightly"], maxConcurrent: 2 };
    writeFileSync(heartbeatPath(join(dir, "state")), JSON.stringify(beat));
    const r = cod(dir, ["supervise"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not running");
  });

  test("the code that exec'd a second supervisor is gone, not merely unreached", async () => {
    const module = await import("../src/supervise");
    expect(Object.keys(module)).toEqual(["containerNameFor"]);
  });
});

describe("an abandoned job is reported once", () => {
  // Assembled at run time, so the repository's secret scan does not flag a fixture.
  const token = ["ghp", "0123456789abcdefghijABCDEFGHIJ012345"].join("_");
  const cron = { name: "nightly", agent: "builder", task: `run with token ${token}`, schedule: "0 0 * * *", enabled: true } as never;

  test("archived after it is reported, so the next start does not repeat it", () => {
    const state = scratch();
    beginJob(state, cron, Date.now() - 10 * 60 * 60 * 1000);
    const first = findAbandoned(state);
    expect(first).toHaveLength(1);
    archiveAbandoned(state, first[0]!);
    expect(findAbandoned(state)).toHaveLength(0);
    // Renamed, not deleted: the evidence stays.
    expect(readdirSync(join(state, "inflight")).some((name) => name.endsWith(".abandoned"))).toBe(true);
  });

  test("archiving twice, or a marker already gone, is harmless", () => {
    const state = scratch();
    beginJob(state, cron, Date.now() - 10 * 60 * 60 * 1000);
    const [job] = findAbandoned(state);
    archiveAbandoned(state, job!);
    expect(() => archiveAbandoned(state, job!)).not.toThrow();
  });

  test("the marker's task is redacted, like the result beside it", () => {
    const state = scratch();
    beginJob(state, cron);
    const [marker] = claimInflight(state);
    expect(marker?.task).not.toContain(token);
    expect(readFileSync(join(state, "inflight", marker!.marker), "utf8")).not.toContain(token);
  });
});
