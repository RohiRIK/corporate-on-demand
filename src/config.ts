/**
 * Configuration resolution: flag -> environment -> workspace file -> default.
 *
 * Every setting reports where it came from, because "why is this using the
 * wrong directory" is the question that wastes the most time when a tool has
 * both a config file and environment variables. `cod config show` prints the
 * source next to the value rather than making the user guess.
 */

import { chownSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { UsageError } from "./errors";

export const DEFAULTS = {
  stateDir: join(homedir(), ".local", "share", "cod"),
  /**
   * The tag for the image *we build*, not the base it is built FROM. Naming it
   * after the base image makes `docker image inspect` succeed against the base
   * and report "cached" without anything of ours ever being built — a silent
   * no-op that looks like success.
   */
  image: "cod-sandbox:1.3.12",
  format: "table",
} as const;

export type OutputFormat = "table" | "json";

export interface Config {
  readonly workspaceFile: string;
  readonly stateDir: string;
  readonly image: string;
  readonly format: OutputFormat;
  /** Where each resolved value came from, for `config show`. */
  readonly sources: Readonly<Record<"stateDir" | "image" | "format", ConfigSource>>;
}

export type ConfigSource = "flag" | "environment" | "file" | "default";

export interface ConfigFlags {
  readonly state?: string | undefined;
  readonly image?: string | undefined;
  readonly format?: string | undefined;
  readonly workspace?: string | undefined;
}

const ENV_KEYS = {
  stateDir: "COD_STATE_DIR",
  image: "COD_IMAGE",
  format: "COD_FORMAT",
  workspace: "COD_WORKSPACE",
} as const;

/**
 * The workspace file path, resolved even when the file does not exist yet.
 *
 * `cod init` has to write to a path that does not exist, so it cannot ask
 * "does the workspace file exist?" to decide where the file goes. Resolution
 * and existence are deliberately separate.
 */
export function resolvedWorkspaceFile(flags: ConfigFlags = {}): string {
  const flag = flags.workspace;
  if (flag !== undefined) return resolve(flag);

  const env = process.env[ENV_KEYS.workspace];
  if (env !== undefined && env !== "") return resolve(env);

  return resolve(process.cwd(), "cod.json");
}

function parseFormat(raw: string, origin: ConfigSource): OutputFormat {
  if (raw === "table" || raw === "json") return raw;
  throw new UsageError(
    `format must be "table" or "json" (from ${origin}); received "${raw}"`,
  );
}

export function loadConfig(flags: ConfigFlags = {}): Config {
  const workspaceFile = resolvedWorkspaceFile(flags);
  const sources: Record<"stateDir" | "image" | "format", ConfigSource> = {
    stateDir: "default",
    image: "default",
    format: "default",
  };

  // The file is optional everywhere except the commands that need a workspace,
  // so a missing file is not an error at resolution time.
  let file: Record<string, unknown> = {};
  if (existsSync(workspaceFile)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(workspaceFile, "utf8"));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        file = parsed as Record<string, unknown>;
      }
    } catch (error) {
      throw new UsageError(
        `${workspaceFile} is not valid JSON: ${(error as Error).message}`,
      );
    }
  }

  function pick<T>(
    key: "stateDir" | "image" | "format",
    flagValue: string | undefined,
    fallback: T,
  ): { value: T; source: ConfigSource } {
    if (flagValue !== undefined && flagValue !== "") {
      return { value: flagValue as T, source: "flag" };
    }
    const env = process.env[ENV_KEYS[key]];
    if (env !== undefined && env !== "") {
      return { value: env as T, source: "environment" };
    }
    const fromFile = file[key];
    if (typeof fromFile === "string" && fromFile !== "") {
      return { value: fromFile as T, source: "file" };
    }
    return { value: fallback, source: "default" };
  }

  const state = pick("stateDir", flags.state, DEFAULTS.stateDir);
  const image = pick("image", flags.image, DEFAULTS.image);
  const format = pick("format", flags.format, DEFAULTS.format);

  sources.stateDir = state.source;
  sources.image = image.source;
  sources.format = format.source;

  return {
    workspaceFile,
    stateDir: resolve(state.value),
    image: image.value,
    format: parseFormat(format.value, format.source),
    sources,
  };
}

/**
 * The uid and gid the container runs as (`--user` in src/docker.ts), and so
 * the owner the state directory - its one writable bind mount - needs.
 */
export const CONTAINER_UID = 1000;
export const CONTAINER_GID = 1000;

/**
 * Create a directory the container will write, owned so that it can.
 *
 * A bind mount carries the HOST's ownership into the container. A state
 * directory created by a root `cod init` was root's, the supervisor (uid 1000)
 * died on its first mkdir, and `cod up` could only report "not live". So when
 * root creates one, it hands it to the container's uid - only a directory it
 * has just CREATED, never one that already existed, which is the operator's to
 * own (ops/ creates its own with `install -d -o 1000`). Created 0750.
 */
export function makeContainerDir(path: string): void {
  // 0750: the ledger, the results and the log are nobody else's business on a
  // shared host. A default-umask directory left them world-readable (SEC-07).
  const created = mkdirSync(path, { recursive: true, mode: 0o750 });
  if (created !== undefined && process.platform === "linux" && process.getuid?.() === 0) {
    chownSync(path, CONTAINER_UID, CONTAINER_GID);
  }
}

/** Create the state directory and its parents; returns the directory. */
export function ensureStateDir(config: Config): string {
  makeContainerDir(config.stateDir);
  makeContainerDir(join(config.stateDir, "bus"));
  return config.stateDir;
}

/** Create the parent directory of a file that may not exist yet. */
export function ensureParentDir(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
}

/** The file in a state directory that names the workspace it belongs to. */
export const OWNER_FILE = "workspace.json";

/**
 * Bind a state directory to ONE workspace, or refuse.
 *
 * The default state directory is the same for every workspace on the machine,
 * while containers and volumes are per workspace. So a second workspace on the
 * default directory shared the first one's ledger, heartbeat, results and log:
 * its `cod status` read the other supervisor's heartbeat, and its governance
 * dispatched the other company's work. The first workspace to use a state
 * directory owns it; another one is refused with the two fixes.
 */
export function claimStateDir(config: Pick<Config, "stateDir" | "workspaceFile">): void {
  const owner = join(config.stateDir, OWNER_FILE);
  if (existsSync(owner)) {
    let recorded = "";
    try {
      recorded = String((JSON.parse(readFileSync(owner, "utf8")) as { workspace?: unknown }).workspace ?? "");
    } catch {
      recorded = "";
    }
    if (recorded !== "" && recorded !== config.workspaceFile) {
      throw new UsageError(
        `the state directory ${config.stateDir} belongs to another workspace (${recorded}). ` +
          "Give this one its own with --state <dir> or COD_STATE_DIR - or, if you MOVED that workspace " +
          `to ${config.workspaceFile}, delete ${owner}.`,
      );
    }
    if (recorded === config.workspaceFile) return;
  }
  makeContainerDir(config.stateDir);
  writeFileSync(owner, `${JSON.stringify({ workspace: config.workspaceFile }, null, 2)}\n`, "utf8");
}
