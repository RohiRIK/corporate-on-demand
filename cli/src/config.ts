import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RuntimeFailure } from "./exit.ts";
import type { WorkspaceConfig } from "./types.ts";

export interface ResolvedConfig {
  readonly image: string;
  readonly namePrefix: string;
  readonly workspaceRoot: string;
  readonly opencodeVersion: string;
  readonly defaultModel: string;
  readonly agentTimeoutMs: number;
}

/** exactOptionalPropertyTypes: overrides are explicitly `| undefined`. */
export type ConfigOverrides = { [K in keyof ResolvedConfig]?: string | undefined };

/** Flags win over .env, which wins over built-in defaults. */
export function resolveConfig(
  cwd: string,
  flags: ConfigOverrides = {},
  env: Record<string, string | undefined> = process.env,
): ResolvedConfig {
  const fileEnv = readDotEnv(join(cwd, ".env"));
  const pick = (key: string, fallback: string): string => fileEnv[key] ?? env[key] ?? fallback;
  return {
    image: flags.image ?? pick("COD_IMAGE", "oven/bun:1.3.12"),
    namePrefix: flags.namePrefix ?? pick("COD_NAME_PREFIX", "cod"),
    workspaceRoot: flags.workspaceRoot ?? resolve(cwd, pick("COD_WORKSPACE_ROOT", ".cod/workspaces")),
    opencodeVersion: flags.opencodeVersion ?? pick("COD_OPENCODE_VERSION", "1.18.31"),
    defaultModel: flags.defaultModel ?? pick("COD_AGENT_MODEL", "anthropic/claude-sonnet-4-5"),
    agentTimeoutMs: flags.agentTimeoutMs !== undefined ? Number(flags.agentTimeoutMs) : Number(pick("COD_AGENT_TIMEOUT_MS", "900000")),
  };
}

export function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    out[t.slice(0, eq).trim()] = t
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

export function workspaceDir(root: string, name: string): string {
  return join(root, name);
}

export function writeWorkspaceConfig(path: string, config: WorkspaceConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function loadWorkspaceConfig(path: string): WorkspaceConfig {
  if (!existsSync(path)) {
    throw new RuntimeFailure(
      `No workspace config at ${path}`,
      "Run `cod init` first to create one.",
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new RuntimeFailure(`Malformed workspace config at ${path}`);
  }
  return parsed as WorkspaceConfig;
}
