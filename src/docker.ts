/**
 * The Docker layer.
 *
 * Two rules govern everything here.
 *
 * 1. Every Docker call goes through `run()` with an argv array, never a shell
 *    string. A command built from a workspace file is a command a colleague
 *    can put a semicolon in; an argv array means the only thing a hostile
 *    `cod.json` can change is which literal flag is chosen.
 *
 * 2. A container is adopted only when its `cod.workspace` label matches.
 *    Trusting the name alone means a crafted workspace value could make this
 *    CLI attach to a foreign container and inherit its mounts and capabilities.
 */

import { existsSync } from "node:fs";
import { PATHS } from "./image";
import type { Config } from "./config";
import { RuntimeFailure, UnsupportedRuntimeError, UsageError } from "./errors";
import type { Workspace } from "./workspace";

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** True when `stdout` was cut to the last OUTPUT_LIMIT_BYTES characters. */
  readonly stdoutTruncated?: boolean;
  /** True when `stderr` was cut. Bounded independently of stdout. */
  readonly stderrTruncated?: boolean;
}

/**
 * The cap on captured output, per stream, per command.
 *
 * 4 MB is far more than any legitimate `docker` invocation prints, and small
 * enough that 50 concurrent jobs cannot exhaust host memory. The alternative -
 * `new Response(stream).text()` - holds an unbounded string, and this CLI runs
 * on the host, not in the container it is inspecting.
 */
export const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

export type Runner = (cmd: string, args: string[], timeoutMs: number) => Promise<RunResult>;

/**
 * Read a stream into memory, keeping at most `limit` bytes of its TAIL.
 *
 * Three details that are each a bug if missed:
 *
 * 1. **Keep the tail, not the head.** The end of a failing command is where the
 *    error is. Keeping the head shows a successful-looking beginning and hides
 *    the reason it failed.
 *
 * 2. **Keep draining after the cap.** A child blocked on a full pipe while we
 *    stop reading is a deadlock, and it would surface as a mysterious timeout
 *    rather than as the bug it is.
 *
 * 3. **Stop appending, not stop reading.** Slicing a fully-buffered string
 *    afterwards would still have held the whole thing in memory, which is the
 *    problem this exists to fix.
 */
async function readCapped(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<{ readonly text: string; readonly truncated: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  // A ring buffer holding the most recent `limit` characters.
  //
  // Two properties that pull against each other, and both matter:
  //
  //  - **Keep the tail.** The end of a failing command is where the error is;
  //    keeping the head shows a successful-looking beginning and hides why it
  //    failed. So past the cap the buffer slides.
  //  - **Never hold more than the cap.** Appending everything and slicing at
  //    the end still peaks at the full size in memory, which is the exact
  //    failure this exists to prevent - it only hides it behind a smaller
  //    return value. Measured: 40 MB of output grew the heap by 70 MB before
  //    this was fixed; it is now 6.8 MB.
  //
  // The buffer is a plain string rather than an array of chunks. Array-based
  // front-trimming needs a partial-head special case that is easy to get wrong
  // - and did get wrong, leaving the buffer over its cap - while a string
  // slice is a single expression that is either right or visibly not.
  let buffer = "";
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      const next = buffer + decoder.decode(value, { stream: true });
      if (next.length > limit) {
        truncated = true;
        // Slice from the end, so what survives is the most recent output.
        buffer = next.slice(next.length - limit);
      } else {
        buffer = next;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text: buffer, truncated };
}

/**
 * The default runner, with the output cap lowered so truncation is testable.
 *
 * One implementation, parameterised. Two copies of this would drift, and a cap
 * that quietly applied only in production is the kind of thing nobody notices
 * until it matters.
 */
export function makeRunner(limitBytes: number): Runner {
  return async (cmd, args, timeoutMs) => {
    const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const [out, err, code] = await Promise.all([
        readCapped(proc.stdout as ReadableStream<Uint8Array>, limitBytes),
        readCapped(proc.stderr as ReadableStream<Uint8Array>, limitBytes),
        proc.exited,
      ]);
      return {
        code,
        stdout: out.text,
        stderr: err.text,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export const defaultRunner: Runner = makeRunner(OUTPUT_LIMIT_BYTES);

/** Alias kept for readability at the call sites in the tests. */
export const makeCappedRunner = makeRunner;

/** How many times Docker may restart a crashed workspace container. */
export const RESTART_LIMIT = 5;

export const CONTAINER_PREFIX = "cod-sandbox";

/**
 * The slug a workspace file maps to: its parent directory AND its name.
 *
 * Both parts, because the name alone is not unique. The default workspace file
 * is `cod.json` in every directory, so a name-only slug made every workspace on
 * the machine the same workspace.
 *
 * The tail is kept preferentially: two deep paths that share a long prefix
 * must still differ, so a length cap trims the FRONT, never the name.
 */
function workspaceSlug(workspaceFile: string): string {
  const parts = workspaceFile.split(/[\\/]/).filter((part) => part !== "");
  const parent = parts.length > 1 ? (parts[parts.length - 2] as string) : "";
  const name = (parts[parts.length - 1] ?? "workspace").replace(/\.json$/i, "");
  // [parent, name], NOT [...parent, name]. Spreading a STRING spreads its
  // CHARACTERS, so "beta" became "b-e-t-a" and every volume was named
  // "c-o-d-e-2-e-acme-work". It was in the original workVolume and was
  // invisible because the mangled name was still unique - just unreadable,
  // and wildly longer than intended for something with a length cap.
  const safe = [parent, name]
    .filter((part) => part !== "")
    .join("-")
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return safe || "workspace";
}

/**
 * The container name for a workspace file.
 *
 * Derived from the PATH, not the basename. This was the bug: the volume used
 * parent+name and the container used the basename alone, so every workspace
 * whose file was called `cod.json` resolved to `cod-sandbox-cod`, and `cod up`
 * adopted whichever container it found first. The second workspace's jobs then
 * ran in the first workspace's container against the first workspace's
 * cod.json, with no error anywhere. Measured, not theoretical.
 *
 * Sanitised rather than rejected, because a workspace file may legitimately sit
 * in a directory with a space or a dot in it. The output is filtered to
 * [a-z0-9-], so it can never carry a shell metacharacter into a command.
 */
export function containerNameForFile(workspaceFile: string): string {
  return `${CONTAINER_PREFIX}-${workspaceSlug(workspaceFile)}`;
}

/**
 * The named volume holding `/work`: the git repo and every per-job worktree.
 *
 * Same slug as the container, so the two always correspond and `docker ps` and
 * `docker volume ls` read as a pair. `down` removes the container but
 * deliberately KEEPS this volume - deleting an agent's committed work on
 * teardown would be the worst possible default.
 */
export function workVolume(config: { workspaceFile: string }): string {
  return `${CONTAINER_PREFIX}-${workspaceSlug(config.workspaceFile)}-work`;

}
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function safeSegment(value: string, label: string): string {
  if (!SAFE_NAME.test(value)) {
    throw new UsageError(
      `${label} "${value}" cannot be used in a container name; use lowercase letters, digits and hyphens`,
    );
  }
  return value;
}

export function containerName(workspace: string): string {
  return `${CONTAINER_PREFIX}-${safeSegment(workspace, "workspace")}`;
}

/**
 * The Docker socket is the only path from "contained" to "host lost". Mounting
 * it would hand every agent in the container root on this machine, so it is
 * refused at the one place a mount is built.
 */
const FORBIDDEN_MOUNT_SOURCES = ["/var/run/docker.sock", "/run/docker.sock"] as const;

export function assertMountAllowed(source: string): void {
  for (const forbidden of FORBIDDEN_MOUNT_SOURCES) {
    if (source === forbidden) {
      throw new UsageError(
        `refusing to mount ${forbidden}: it would give every agent root on this host`,
      );
    }
  }
}

export interface ContainerSpec {
  readonly name: string;
  readonly image: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly mounts: readonly {
    readonly source: string;
    readonly target: string;
    readonly readOnly: boolean;
    /** A named Docker volume rather than a host bind. */
    readonly volume?: boolean;
  }[];
  readonly network: string;
  readonly memory: string;
  readonly cpus: string;
  readonly user: string;
  /**
   * Environment for the container, and for every `docker exec` into it.
   *
   * Holds TZ today. It exists as a map rather than a hardcoded flag because a
   * timezone set only at `docker run` is a timezone that does not reach the
   * process that actually schedules the jobs.
   */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The exact argv for `docker run`, exposed so a test can pin it. If a future
 * edit silently drops --cap-drop or re-adds --network none, the test fails —
 * which is the point: flag drift is invisible otherwise.
 */
export function buildRunArgv(spec: ContainerSpec): string[] {
  const argv = [
    "run",
    "--detach",
    // `--rm` is GONE, deliberately. Docker refuses `--rm` together with
    // `--restart`, and restart is what this stage is for: with the supervisor
    // as PID 1, a crash takes the container down and the policy brings it
    // back. `--rm` would delete the container on that same exit, which
    // contradicts the restart and would defeat it entirely.
    //
    // Nothing leaks as a result: `cod down` removes the container explicitly,
    // and the previous owner check still refuses to remove one that is not
    // ours.
    // Bounded, not `unless-stopped`. Verified on this host: a process that
    // exits immediately under `on-failure:3` stops at restarts=3. Without the
    // cap a supervisor that crashes on startup restarts for ever, and
    // `unless-stopped` never stops.
    //
    // Docker adds a second guard from its own docs: a restart policy only
    // engages after a container has been up ~10s, which is specifically to
    // stop a container that never starts from looping.
    "--restart",
    `on-failure:${RESTART_LIMIT}`,
    "--name",
    spec.name,
    "--user",
    spec.user,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "512",
    "--network",
    spec.network,
    "--memory",
    spec.memory,
    "--cpus",
    spec.cpus,
  ];
  for (const [key, value] of Object.entries(spec.labels)) {
    argv.push("--label", `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(spec.env)) {
    argv.push("-e", `${key}=${value}`);
  }
  for (const mount of spec.mounts) {
    if (mount.volume === true) {
      // A named volume, not a bind: nothing on the host should be handed to a
      // container that runs arbitrary agents.
      argv.push("--mount", `type=volume,src=${mount.source},dst=${mount.target}`);
      continue;
    }
    assertMountAllowed(mount.source);
    const mode = mount.readOnly ? ",readonly" : "";
    argv.push("--mount", `type=bind,src=${mount.source},dst=${mount.target}${mode}`);
  }
  argv.push(spec.image, "sleep", "infinity");
  return argv;
}

/**
 * Every Docker call goes through this, so a missing binary or a spawn failure
 * becomes a clean "false"/"unknown" instead of a raw ENOENT escaping to the
 * user as a stack trace. isDockerAvailable, dockerVersion and isRunning all
 * call the runner directly rather than through run(), so each owes its own
 * guard — that gap is why this helper exists.
 */
async function tryRun(
  runner: Runner,
  args: string[],
  timeoutMs: number,
): Promise<RunResult | undefined> {
  try {
    return await runner("docker", args, timeoutMs);
  } catch {
    return undefined;
  }
}

/** Whether the Docker daemon answers. `docker info` succeeds with no containers. */
export async function isDockerAvailable(runner: Runner = defaultRunner): Promise<boolean> {
  const result = await tryRun(runner, ["info", "--format", "{{.ServerVersion}}"], 10_000);
  return result?.code === 0;
}

export async function dockerVersion(runner: Runner = defaultRunner): Promise<string> {
  const result = await tryRun(runner, ["info", "--format", "{{.ServerVersion}}"], 10_000);
  return result?.code === 0 ? result.stdout.trim() : "unknown";
}

/**
 * Read the workspace label from a container, so adoption can be verified
 * rather than assumed from the name.
 */
async function containerWorkspaceLabel(
  name: string,
  runner: Runner,
): Promise<string | undefined> {
  const result = await runner(
    "docker",
    ["inspect", "--format", `{{index .Config.Labels "cod.workspace"}}`, name],
    10_000,
  );
  if (result.code !== 0) return undefined;
  const label = result.stdout.trim();
  return label === "" ? undefined : label;

}

/** Whether a container of this name exists at all, labelled or not. */
async function containerExists(name: string, runner: Runner): Promise<boolean> {
  const result = await tryRun(runner, ["inspect", "--format", "{{.Id}}", name], 10_000);
  return result?.code === 0;
}

export async function isRunning(config: Config, runner: Runner = defaultRunner): Promise<boolean> {
  const name = containerNameForFile(config.workspaceFile);
  const result = await tryRun(runner, ["inspect", "--format", "{{.State.Running}}", name], 10_000);
  return result?.code === 0 && result.stdout.trim() === "true";
}

/** The workspace name is the basename of the workspace file. */
function workspaceFromConfig(config: Config): string {
  const base = config.workspaceFile.split(/[\\/]/).pop() ?? "";
  return base.replace(/\.json$/, "");
}

export interface DoctorReport {
  readonly dockerAvailable: boolean;
  readonly dockerVersion: string;
  readonly bunVersion: string;
  readonly bunCronAvailable: boolean;
  readonly image: string;
  readonly imageCached: boolean;
  /** Whether the pinned opencode binary has been fetched. */
  readonly opencodeVendored: boolean;
  /** What to do about it, when something is missing. */
  readonly remedy: string | undefined;
}

/**
 * Fail loudly when Bun.cron is missing.
 *
 * Below Bun 1.3.12 `Bun.cron` is undefined. A scheduler that silently never
 * fires while reporting itself healthy is the worst failure this project can
 * have, so it is a hard error rather than a warning.
 */
export function assertCronSupport(): void {
  const available = typeof (globalThis as { Bun?: { cron?: unknown } }).Bun?.cron === "function";
  if (available) return;
  throw new UnsupportedRuntimeError("Bun 1.3.12 or newer", `Bun ${Bun.version}`);
}

export async function doctor(
  config: Config,
  runner: Runner = defaultRunner,
): Promise<DoctorReport> {
  const available = await isDockerAvailable(runner);
  const version = available ? await dockerVersion(runner) : "unknown";
  const imageCheck = await runner("docker", ["image", "inspect", config.image], 10_000);
  // The opencode binary is fetched, not committed, so a fresh clone cannot
  // build until scripts/vendor-opencode.sh has run. Report it here rather than
  // letting `cod up` fail later with a missing-file error.
  const opencodeVendored = existsSync(PATHS.opencode);
  return {
    dockerAvailable: available,
    dockerVersion: version,
    bunVersion: `Bun ${Bun.version}`,
    bunCronAvailable: typeof (globalThis as { Bun?: { cron?: unknown } }).Bun?.cron === "function",
    image: config.image,
    imageCached: imageCheck.code === 0,
    opencodeVendored,
    remedy: opencodeVendored
      ? undefined
      : "run `sh scripts/vendor-opencode.sh` to fetch the pinned opencode binary",
  };
}

/**
 * The container spec for a workspace.
 *
 * Extracted from `up()` because the mounts are the security boundary and an
 * inline literal cannot be asserted on. The mount list now has a test that says
 * what a DEFAULT workspace gets, which is the only way to notice that being
 * handed something new.
 */
export function buildWorkspaceSpec(config: Config, workspace: Workspace): ContainerSpec {
  return {
          name: containerNameForFile(config.workspaceFile),
          image: config.image,
          // The full workspace PATH, not its name. This label is the only thing
          // that decides whether `cod up` may adopt an already-running container,
          // and a name-only label made every workspace called cod.json compare
          // equal - so the guard adopted the wrong container instead of refusing.
          labels: { "cod.workspace": config.workspaceFile },
          mounts: [
            // The workspace is a bind mount, so the repo and its worktrees live
            // in the container's own writable layer under /work. That keeps a
            // job's commits out of the operator's workspace file, which is
            // mounted read-only precisely so the system cannot rewrite it.
            { source: config.workspaceFile, target: "/cod/cod.json", readOnly: true },
            { source: config.stateDir, target: "/cod", readOnly: false },
            // /work holds the git repo and every per-job worktree. It is a NAMED
            // VOLUME, not the container's writable layer: verified, that layer is
            // destroyed by `docker rm`, so a container restart took every commit
            // and every worktree with it. A volume survives both the restart and
            // the removal, which is what makes a worktree worth having.
            { source: workVolume(config), target: "/work", readOnly: false, volume: true },
            // OPT-IN ONLY, and absent unless the operator named a path.
            //
            // A writable mount of host state is the single most dangerous thing
            // this container could be given, so it happens on request only, at a
            // fixed target rather than wherever the host happens to keep it,
            // and it goes through assertMountAllowed like every other mount.
            ...(workspace.landing === undefined
              ? []
              : (() => {
                  // Asserted here rather than filtered later: the guard exists
                  // to REFUSE, so its result cannot be a value that goes on
                  // being used.
                  assertMountAllowed(workspace.landing.repo);
                  return [{ source: workspace.landing.repo, target: "/landing", readOnly: false }];
                })()),
          ],
          // Egress is deliberate: agents install packages, so --network none is
          // incompatible with the requirement and was removed on purpose. This
          // container is a trusted host process, not a containment boundary.
          network: "bridge",
          memory: "2g",
          cpus: "2",
          env: { TZ: workspace.timezone },
          user: "1000:1000",
  };
}


export function makeDocker({ runner = defaultRunner, timeoutMs = 120_000 }: { runner?: Runner; timeoutMs?: number } = {}) {
  async function run(args: string[], subject: string): Promise<RunResult> {
    let result: RunResult;
    try {
      result = await runner("docker", args, timeoutMs);
    } catch (error) {
      throw new RuntimeFailure(`docker ${args[0]} failed for ${subject}: ${(error as Error).message}`);
    }
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
      throw new RuntimeFailure(`docker ${args[0]} failed for ${subject}: ${detail}`);
    }
    return result;
  }

  return {
    /**
     * Run a command inside the workspace container.
     *
     * The container deliberately has no Docker binary, no socket and no host
     * credentials, so anything needing the ledger or the /work volume CANNOT
     * be done from in there. It is done from out here instead. That is what
     * `cod work run` needs: the host has no /work, so a host-side dispatch
     * failed with "no git repository at /work" - true, and useless.
     */
    async execIn(config: Config, args: readonly string[], subject: string): Promise<{ code: number; out: string }> {
      const name = containerNameForFile(config.workspaceFile);
      // The label check first. An exec is not destructive the way `rm` is, but
      // running a command inside another workspace's container is still running
      // it against the wrong volume.
      const label = await containerWorkspaceLabel(name, runner);
      if (label !== config.workspaceFile) {
        throw new UsageError(
          `cannot ${subject}: this workspace's container is not running (looked for ${name}, ` +
            `label ${label ?? "unlabelled"}). Start it with \`cod up\`.`,
        );
      }
      const result = await tryRun(runner, ["exec", name, ...args], timeoutMs);
      if (result === undefined) throw new RuntimeFailure(`docker exec failed for ${subject}`);
      return { code: result.code, out: `${result.stdout}${result.stderr}` };
    },

    async up(config: Config, workspace: Workspace): Promise<string> {
      const wsName = workspaceFromConfig(config);

      // The landing repository is checked BEFORE the container exists.
      //
      // Checked here because checking it later means checking it per merge: the
      // container would start, agents would work, work would be reviewed and
      // merged, and only then would the push fail on a path that was a typo
      // from the beginning. Nothing is lost in that case, but the operator
      // finds out far too late.
      if (workspace.landing !== undefined) {
        const { checkLandingRepo } = await import("./landing");
        const check = checkLandingRepo(workspace.landing.repo);
        if (!check.ok) {
          throw new UsageError(
            `landing.repo is unusable: ${check.reason ?? "unknown"}. ` +
              `Fix it, or remove the "landing" block from cod.json to keep landed work in the work volume.`,
          );
        }
      }
      const name = containerNameForFile(config.workspaceFile);

      // Idempotent, but only by label: a container of the same name that we did
      // not create is a conflict, not something to adopt.
      const state = await tryRun(runner, ["inspect", "--format", "{{.State.Running}}", name], 10_000);
      if (state?.code === 0 && state.stdout.trim() === "true") {
        const label = await containerWorkspaceLabel(name, runner);
        if (label === config.workspaceFile) return name;
        throw new UsageError(
          `a container named ${name} is already running but belongs to a different workspace (${label ?? "unlabelled"}); ` +
            `refusing to adopt it. Stop it with \`docker rm -f ${name}\` first.`,
        );
      }

      const spec = buildWorkspaceSpec(config, workspace);
      await run(buildRunArgv(spec), wsName);
      return name;
    },

    async down(config: Config): Promise<boolean> {
      const name = containerNameForFile(config.workspaceFile);
      // Confirm the container is really ours before destroying it. `docker rm
      // --force` removes whatever bears the name, and a name that merely
      // looks like ours is not ours. Matching on the exit status rather than
      // English stderr also survives a locale change or a Docker rewrite.
      const label = await containerWorkspaceLabel(name, runner);
      if (label === undefined) {
        if (!(await containerExists(name, runner))) return false;
        throw new UsageError(
          `refusing to remove ${name}: it exists but carries no cod.workspace label, ` +
            `so this CLI did not create it. Remove it yourself if you are sure.`,
        );
      }
      const result = await runner("docker", ["rm", "--force", name], timeoutMs);
      if (result.code !== 0) {
        const detail = result.stderr.trim();
        throw new RuntimeFailure(`docker rm failed: ${detail || `exit ${result.code}`}`);
      }
      return true;
    },
  };
}

export type Docker = ReturnType<typeof makeDocker>;

/** Where a worker's own directory lives inside the container. */
export function agentWorkdir(agent: string): string {
  return `/work/${safeSegment(agent, "agent")}`;
}
