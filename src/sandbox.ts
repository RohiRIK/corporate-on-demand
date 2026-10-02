/**
 * The agent sandbox: what an agent may touch, enforced by the kernel.
 *
 * Every agent runs through `cod-sandbox` (docker/sandbox.c), a Landlock
 * launcher compiled into the image. This file decides the POLICY - which paths
 * an agent may read, and which it may write - and builds the argv. It is pure,
 * so the policy is testable on any machine; the enforcement is tested against a
 * real kernel in tests/sandbox.test.ts and in the image.
 *
 * What it closes (SEC-03). Before this, the security posture said, accurately,
 * that agent confinement was "a convention, not a control": an agent with a
 * shell could
 *   - rewrite the work ledger at /cod - mark its item landed, reset its retry
 *     count, put words in the next retry's brief;
 *   - commit to the base branch directly, or move it, past the reviewer;
 *   - write the main repository's `.git/config` and `.git/hooks`, which the
 *     supervisor's own git then reads;
 *   - rewrite another agent's worktree;
 *   - kill the supervisor.
 *
 * Under the policy below an agent cannot read or write /cod at all; cannot write
 * the main checkout, `.git/config`, `.git/hooks`, `.git/info` or any ref outside
 * `refs/heads/cod/`; can write only its OWN worktree; and, on Landlock ABI 6 or
 * newer, cannot signal a process outside its sandbox.
 *
 * What it does not close, stated rather than implied away:
 *   - read access: an agent can still READ the repository and other worktrees;
 *   - `/tmp` and `$HOME` are shared by every agent, so they can interfere there;
 *   - the git object store is writable (commits need it), so an agent can damage
 *     objects - which the host-side export verifies (src/export.ts);
 *   - any `cod/` branch ref is writable, not only the agent's own: a ref is a
 *     file in a shared directory, and Landlock grants directories;
 *   - egress is open by design.
 */

/** Where the launcher lives in the image. Set as COD_SANDBOX by the Dockerfile. */
export const SANDBOX_BIN = "/usr/local/bin/cod-sandbox";

export interface SandboxPolicy {
  /** Readable and executable beneath these paths. */
  readonly readOnly: readonly string[];
  /** Everything beneath these paths. */
  readonly readWrite: readonly string[];
}

/**
 * What every agent needs to read: the system, and nothing of cod's own state.
 *
 * `/proc` and `/sys` are needed by runtimes that size themselves from the
 * machine; Landlock still refuses ptrace-gated `/proc/<pid>` entries of a
 * process outside the sandbox. `/cod` is deliberately absent, so it is denied.
 */
export const SYSTEM_READ: readonly string[] = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/lib32", "/etc", "/opt", "/proc", "/sys", "/var"];

/** What every agent may write: scratch space, its tool caches, and devices. */
export function commonWrite(home: string, tmp = "/tmp"): string[] {
  return [tmp, "/dev", home];
}

export interface JobPolicyInput {
  /** The main repository, e.g. /work. */
  readonly repo: string;
  /** This job's worktree. */
  readonly worktree: string;
  /** The job name: the worktree's directory and branch are named for it. */
  readonly job: string;
  readonly home: string;
  /** A plan only reads; a task writes its own worktree and commits. */
  readonly mode: "write" | "read";
  /** The shared scratch directory. `/tmp` in the container. */
  readonly tmp?: string;
}

/**
 * The policy for a job that runs in a worktree.
 *
 * The repository is readable. A writing job may also write exactly what a
 * commit on its own branch needs from the shared git directory - the object
 * store, the `cod/` refs and their reflogs, and its own worktree metadata - and
 * nothing else in it: not `config`, not `hooks`, not `info`, not the base
 * branch's ref, not the main checkout's index or HEAD.
 */
export function jobPolicy(input: JobPolicyInput): SandboxPolicy {
  const git = `${input.repo}/.git`;
  const readOnly = [...SYSTEM_READ, input.repo];
  if (input.mode === "read") {
    return { readOnly, readWrite: commonWrite(input.home, input.tmp) };
  }
  return {
    readOnly,
    readWrite: [
      ...commonWrite(input.home, input.tmp),
      input.worktree,
      `${git}/objects`,
      `${git}/refs/heads/cod`,
      `${git}/logs/refs/heads/cod`,
      `${git}/worktrees/${input.job}`,
    ],
  };
}

/**
 * The policy for a read-only role - the reviewer, a meeting voice - which needs
 * no repository at all: everything it judges is in its prompt.
 */
export function rolePolicy(scratch: string, home: string, tmp?: string): SandboxPolicy {
  return { readOnly: [...SYSTEM_READ], readWrite: [...commonWrite(home, tmp), scratch] };
}

/** The argv that runs `argv` under `policy`. */
export function sandboxedArgv(bin: string, policy: SandboxPolicy, argv: readonly string[]): string[] {
  const rules: string[] = [];
  for (const path of policy.readOnly) rules.push("--ro", path);
  for (const path of policy.readWrite) rules.push("--rw", path);
  return [bin, ...rules, "--", ...argv];
}

/** How a workspace asks for agents to run. */
export type SandboxMode = "required" | "off";

/** A sandbox to apply, or the reason there is none. */
export type SandboxChoice =
  | { readonly kind: "on"; readonly bin: string }
  | { readonly kind: "off" }
  | { readonly kind: "missing"; readonly reason: string };

/**
 * Decide whether agents run sandboxed.
 *
 * `off` is an explicit, recorded choice in cod.json. `required` - the default -
 * with no launcher is NOT a silent downgrade: it is `missing`, and a job asked to
 * run that way fails with the reason rather than running unconfined.
 */
export function chooseSandbox(mode: SandboxMode | undefined, bin: string | undefined, exists: (path: string) => boolean): SandboxChoice {
  if (mode === "off") return { kind: "off" };
  if (bin === undefined || bin === "") {
    return { kind: "missing", reason: "no agent sandbox is installed (COD_SANDBOX is unset); rebuild the image, or set \"agentSandbox\": \"off\" to accept the risk" };
  }
  if (!exists(bin)) {
    return { kind: "missing", reason: `the agent sandbox ${bin} is missing; rebuild the image, or set "agentSandbox": "off" to accept the risk` };
  }
  return { kind: "on", bin };
}

/** One line for the heartbeat and `cod status`. */
export function describeSandbox(choice: SandboxChoice, probe: string | null): string {
  if (choice.kind === "off") return "OFF (agentSandbox: off in cod.json)";
  if (choice.kind === "missing") return `MISSING - agents will not run: ${choice.reason}`;
  if (probe === null) return "unknown";
  return probe.startsWith("landlock abi") ? `on (${probe})` : `UNAVAILABLE - agents will not run: ${probe}`;
}
