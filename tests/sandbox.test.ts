import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  jobPolicy, rolePolicy, sandboxedArgv, chooseSandbox, describeSandbox, SYSTEM_READ, type SandboxPolicy,
} from "../src/sandbox";
import { runAgent, type CommandRunner } from "../src/agent";
import type { Cron } from "../src/workspace";

/**
 * The agent sandbox (SEC-03).
 *
 * Two halves. The POLICY is pure and tested everywhere. The ENFORCEMENT is the
 * kernel's: the launcher in docker/sandbox.c is compiled here and real git runs
 * through it, so what is asserted is what Landlock actually refuses - not what
 * a policy object says it would. That half needs gcc and a kernel with
 * Landlock; without them it is skipped and says so.
 */

const dirs: string[] = [];
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the policy", () => {
  const job = jobPolicy({ repo: "/work", worktree: "/work/.cod-worktrees/w-1", job: "w-1", home: "/home/bun", mode: "write" });

  test("cod's own state is never granted, so it is denied", () => {
    for (const path of [...job.readOnly, ...job.readWrite]) {
      expect(path === "/cod" || path.startsWith("/cod/")).toBe(false);
    }
  });

  test("a writing job writes its own worktree and what a commit needs - not config, hooks or the base ref", () => {
    expect(job.readWrite).toContain("/work/.cod-worktrees/w-1");
    expect(job.readWrite).toContain("/work/.git/objects");
    expect(job.readWrite).toContain("/work/.git/refs/heads/cod");
    expect(job.readWrite).toContain("/work/.git/worktrees/w-1");
    for (const forbidden of ["/work", "/work/.git", "/work/.git/config", "/work/.git/hooks", "/work/.git/info", "/work/.git/refs/heads", "/work/.cod-worktrees"]) {
      expect(job.readWrite).not.toContain(forbidden);
    }
    expect(job.readOnly).toContain("/work");
  });

  test("a PLAN only reads: no worktree, no git write", () => {
    const plan = jobPolicy({ repo: "/work", worktree: "/work/.cod-worktrees/w-2", job: "w-2", home: "/home/bun", mode: "read" });
    expect(plan.readWrite.some((p) => p.startsWith("/work"))).toBe(false);
  });

  test("a read-only role gets no repository at all", () => {
    const role = rolePolicy("/tmp/cod-reviewer-x", "/home/bun");
    expect([...role.readOnly, ...role.readWrite].some((p) => p.startsWith("/work"))).toBe(false);
    expect(role.readWrite).toContain("/tmp/cod-reviewer-x");
  });

  test("the argv puts every rule before `--` and the engine after it", () => {
    const argv = sandboxedArgv("/usr/local/bin/cod-sandbox", { readOnly: ["/usr"], readWrite: ["/tmp"] }, ["opencode", "run", "--", "-x"]);
    expect(argv).toEqual(["/usr/local/bin/cod-sandbox", "--ro", "/usr", "--rw", "/tmp", "--", "opencode", "run", "--", "-x"]);
  });
});

describe("choosing the sandbox", () => {
  test("required with no launcher is MISSING, never a quiet downgrade", () => {
    expect(chooseSandbox("required", undefined, () => true).kind).toBe("missing");
    expect(chooseSandbox(undefined, "/nope", () => false).kind).toBe("missing");
  });

  test("off is an explicit choice, and says so", () => {
    expect(chooseSandbox("off", undefined, () => false).kind).toBe("off");
    expect(describeSandbox({ kind: "off" }, null)).toContain("OFF");
  });

  test("on with a probe that found no Landlock reports agents will not run", () => {
    const on = chooseSandbox("required", "/usr/local/bin/cod-sandbox", () => true);
    expect(on.kind).toBe("on");
    expect(describeSandbox(on, "landlock abi 6")).toContain("on (landlock abi 6)");
    expect(describeSandbox(on, "unavailable: Function not implemented")).toContain("will not run");
  });
});

describe("runAgent and the sandbox", () => {
  const cron: Cron = { name: "j", agent: "builder", task: "do the thing properly", schedule: "0 0 1 1 *", enabled: true, expectTools: false };
  const policy: SandboxPolicy = { readOnly: ["/usr"], readWrite: ["/tmp"] };

  test("a MISSING sandbox refuses before the engine is ever started", async () => {
    let ran = false;
    const runner: CommandRunner = async () => { ran = true; return { stdout: "", stderr: "", code: 0, timedOut: false }; };
    const out = await runAgent(cron, null, async () => {}, { runner, model: "kilo/kilo-auto/free", sandbox: { choice: { kind: "missing", reason: "no launcher here" }, policy } });
    expect(ran).toBe(false);
    expect(out).toContain("agent FAILED: no launcher here");
  });

  test("an ON sandbox wraps the engine's argv in the launcher", async () => {
    let seen: readonly string[] = [];
    const runner: CommandRunner = async (args) => { seen = args; return { stdout: "", stderr: "", code: 1, timedOut: false }; };
    await runAgent(cron, null, async () => {}, { runner, model: "kilo/kilo-auto/free", sandbox: { choice: { kind: "on", bin: "/bin/cod-sandbox" }, policy } });
    expect(seen[0]).toBe("/bin/cod-sandbox");
    expect(seen.indexOf("--")).toBeGreaterThan(0);
    expect(seen[seen.indexOf("--") + 1]).toBe("kilo");
  });
});

// ---- enforcement, against the real kernel -------------------------------

const SOURCE = resolve(import.meta.dir, "..", "docker", "sandbox.c");
function buildLauncher(): { bin: string | null; why: string } {
  if (spawnSync("gcc", ["--version"], { encoding: "utf8" }).status !== 0) return { bin: null, why: "no gcc" };
  const out = join(scratch("cod-sbx-bin-"), "cod-sandbox");
  const built = spawnSync("gcc", ["-static", "-O2", "-Wall", "-Wextra", "-Werror", "-o", out, SOURCE], { encoding: "utf8" });
  if (built.status !== 0) {
    // Static glibc may be absent on a developer machine; dynamic is equivalent for a test.
    const dynamic = spawnSync("gcc", ["-O2", "-Wall", "-Wextra", "-Werror", "-o", out, SOURCE], { encoding: "utf8" });
    if (dynamic.status !== 0) return { bin: null, why: `gcc failed: ${dynamic.stderr.split("\n")[0]}` };
  }
  const probe = spawnSync(out, ["--probe"], { encoding: "utf8" });
  if (probe.status !== 0) return { bin: null, why: `no landlock here: ${probe.stdout.trim()}` };
  return { bin: out, why: probe.stdout.trim() };
}

const launcher = buildLauncher();
if (launcher.bin === null) process.stderr.write(`sandbox enforcement tests SKIPPED: ${launcher.why}\n`);

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A repository with a base, a job worktree, and a state dir standing in for /cod. */
function world() {
  const root = scratch("cod-sbx-");
  const repo = join(root, "work");
  const state = join(root, "cod");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  for (const d of [repo, state, home, tmp]) mkdirSync(d, { recursive: true });
  writeFileSync(join(state, "ledger.sqlite"), "the ledger");
  git(repo, "init", "-q", "-b", "master", ".");
  writeFileSync(join(repo, "notes.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
  for (const job of ["w-mine", "w-other"]) git(repo, "worktree", "add", "-q", "-b", `cod/${job}`, join(repo, ".cod-worktrees", job));
  mkdirSync(join(repo, ".git", "logs", "refs", "heads", "cod"), { recursive: true });
  return { root, repo, state, home, tmp, worktree: join(repo, ".cod-worktrees", "w-mine"), other: join(repo, ".cod-worktrees", "w-other") };
}

/** Run a shell script inside the sandbox; report what each line produced. */
function inside(policy: SandboxPolicy, cwd: string, script: string): { code: number; out: string } {
  const argv = sandboxedArgv(launcher.bin!, policy, ["/bin/sh", "-c", script]);
  const r = spawnSync(argv[0]!, argv.slice(1), { cwd, encoding: "utf8", env: { ...process.env, HOME: policy.readWrite.find((p) => p.endsWith("home")) ?? "/nonexistent" } });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe.skipIf(launcher.bin === null)("enforced by the kernel", () => {
  test("a writing agent CAN commit on its own branch", () => {
    const w = world();
    const policy = jobPolicy({ repo: w.repo, worktree: w.worktree, job: "w-mine", home: w.home, tmp: w.tmp, mode: "write" });
    const r = inside(policy, w.worktree, "echo done > answer.txt && git add answer.txt && git -c user.email=a@a -c user.name=a commit -q -m work && echo COMMITTED");
    expect(r.out).toContain("COMMITTED");
    expect(git(w.repo, "log", "--oneline", "cod/w-mine")).toContain("work");
  });

  test("it CANNOT read or write cod's state", () => {
    const w = world();
    const policy = jobPolicy({ repo: w.repo, worktree: w.worktree, job: "w-mine", home: w.home, tmp: w.tmp, mode: "write" });
    const r = inside(policy, w.worktree, `cat ${w.state}/ledger.sqlite; echo pwned > ${w.state}/ledger.sqlite; echo END`);
    expect(r.out).not.toContain("the ledger");
    expect(r.out).toContain("Permission denied");
    expect(readFileSync(join(w.state, "ledger.sqlite"), "utf8")).toBe("the ledger");
  });

  test("it CANNOT move the base branch, write .git/config or .git/hooks, or touch the main checkout", () => {
    const w = world();
    const before = git(w.repo, "rev-parse", "master");
    const policy = jobPolicy({ repo: w.repo, worktree: w.worktree, job: "w-mine", home: w.home, tmp: w.tmp, mode: "write" });
    inside(policy, w.worktree, [
      "git update-ref refs/heads/master HEAD~0 2>/dev/null",
      `printf '[core]\\n\\tfsmonitor = touch ${w.root}/PWNED\\n' >> ${w.repo}/.git/config`,
      `echo 'touch ${w.root}/PWNED' > ${w.repo}/.git/hooks/post-merge`,
      `echo evil > ${w.repo}/notes.md`,
      "true",
    ].join("; "));
    expect(git(w.repo, "rev-parse", "master")).toBe(before);
    expect(readFileSync(join(w.repo, ".git", "config"), "utf8")).not.toContain("fsmonitor");
    expect(existsSync(join(w.repo, ".git", "hooks", "post-merge"))).toBe(false);
    expect(readFileSync(join(w.repo, "notes.md"), "utf8")).toBe("base\n");
  });

  test("it CANNOT write another agent's worktree", () => {
    const w = world();
    const policy = jobPolicy({ repo: w.repo, worktree: w.worktree, job: "w-mine", home: w.home, tmp: w.tmp, mode: "write" });
    inside(policy, w.worktree, `echo sabotage > ${w.other}/notes.md; true`);
    expect(readFileSync(join(w.other, "notes.md"), "utf8")).toBe("base\n");
  });

  test("a PLAN cannot commit at all", () => {
    const w = world();
    const policy = jobPolicy({ repo: w.repo, worktree: w.worktree, job: "w-mine", home: w.home, tmp: w.tmp, mode: "read" });
    const r = inside(policy, w.worktree, "echo x > answer.txt 2>&1; git add answer.txt 2>&1; echo END");
    expect(r.out).toContain("END");
    expect(existsSync(join(w.worktree, "answer.txt"))).toBe(false);
    expect(git(w.repo, "rev-list", "--count", "cod/w-mine")).toBe("1");
  });

  test("it cannot signal a process outside the sandbox (Landlock ABI 6+)", () => {
    const abi = Number(/abi (\d+)/.exec(launcher.why)?.[1] ?? "0");
    if (abi < 6) return; // scoped signals arrived in ABI 6
    const w = world();
    const policy = rolePolicy(w.tmp, w.home, w.tmp);
    const r = inside(policy, w.tmp, `kill -0 ${process.pid} && echo SIGNALLED || echo REFUSED`);
    expect(r.out).toContain("REFUSED");
  });

  test("system paths stay readable, so the engine and git can run at all", () => {
    expect(SYSTEM_READ).toContain("/usr");
    const w = world();
    const r = inside(rolePolicy(w.tmp, w.home, w.tmp), w.tmp, "git --version && echo RAN");
    expect(r.out).toContain("RAN");
  });
});
