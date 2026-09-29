/**
 * Configuration resolution: flag -> environment -> workspace file -> default.
 *
 * Every setting reports where it came from, because "why is this using the
 * wrong directory" is the question that wastes the most time when a tool has
 * both a config file and environment variables. `cod config show` prints the
 * source next to the value rather than making the user guess.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { UsageError } from "./errors";

export const DEFAULTS = {
  stateDir: join(homedir(), ".local", "share", "cod"),
  image: "oven/bun:1.3.12",
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

/** Create the state directory and its parents; returns the directory. */
export function ensureStateDir(config: Config): string {
  mkdirSync(config.stateDir, { recursive: true });
  mkdirSync(join(config.stateDir, "bus"), { recursive: true });
  return config.stateDir;
}

/** Create the parent directory of a file that may not exist yet. */
export function ensureParentDir(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
}
