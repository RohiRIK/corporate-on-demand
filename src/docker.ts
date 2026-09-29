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

import type { Config } from "./config";
import { RuntimeFailure, UnsupportedRuntimeError, UsageError } from "./errors";
import type { Workspace } from "./workspace";

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Runner = (cmd: string, args: string[], timeoutMs: number) => Promise<RunResult>;

export const defaultRunner: Runner = async (cmd, args, timeoutMs) => {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

const CONTAINER_PREFIX = "cod-sandbox";
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
  readonly mounts: readonly { readonly source: string; readonly target: string; readonly readOnly: boolean }[];
  readonly network: string;
  readonly memory: string;
  readonly cpus: string;
  readonly user: string;
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
    "--rm",
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
  for (const mount of spec.mounts) {
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
  const name = containerName(workspaceFromConfig(config));
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
  return {
    dockerAvailable: available,
    dockerVersion: version,
    bunVersion: `Bun ${Bun.version}`,
    bunCronAvailable: typeof (globalThis as { Bun?: { cron?: unknown } }).Bun?.cron === "function",
    image: config.image,
    imageCached: imageCheck.code === 0,
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
    async up(config: Config, workspace: Workspace): Promise<string> {
      const wsName = workspaceFromConfig(config);
      const name = containerName(wsName);

      // Idempotent, but only by label: a container of the same name that we did
      // not create is a conflict, not something to adopt.
      const state = await tryRun(runner, ["inspect", "--format", "{{.State.Running}}", name], 10_000);
      if (state?.code === 0 && state.stdout.trim() === "true") {
        const label = await containerWorkspaceLabel(name, runner);
        if (label === wsName) return name;
        throw new UsageError(
          `a container named ${name} is already running but belongs to workspace "${label ?? "unknown"}"; ` +
            `refusing to adopt it. Stop it with \`docker rm -f ${name}\` first.`,
        );
      }

      const spec: ContainerSpec = {
        name,
        image: config.image,
        labels: { "cod.workspace": wsName },
        mounts: [
          { source: config.workspaceFile, target: "/cod/cod.json", readOnly: true },
          { source: config.stateDir, target: "/cod", readOnly: false },
        ],
        // Egress is deliberate: agents install packages, so --network none is
        // incompatible with the requirement and was removed on purpose. This
        // container is a trusted host process, not a containment boundary.
        network: "bridge",
        memory: "2g",
        cpus: "2",
        user: "1000:1000",
      };
      await run(buildRunArgv(spec), wsName);
      return name;
    },

    async down(config: Config): Promise<boolean> {
      const name = containerName(workspaceFromConfig(config));
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
