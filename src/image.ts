/**
 * Building the workspace image.
 *
 * A first build pulls ~200 MB and takes minutes; a warm one is instant. The
 * CLI must therefore always say which case it is in — a `cod up` that hangs
 * silently is indistinguishable from a broken one.
 *
 * The base image is pinned by digest, not by tag. A tag is a mutable pointer:
 * `oven/bun:1.3.12` can resolve to different bits tomorrow, and the container
 * would change without the repository changing.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config";
import { RuntimeFailure } from "./errors";
import { defaultRunner, type Runner } from "./docker";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The build inputs, behind a mutable box so a test can point one at a
 * nonexistent path and exercise the guard for real. A missing input must be a
 * named failure before any docker call, not a confusing error from inside a
 * build.
 */
export const PATHS = {
  dockerfile: join(REPO_ROOT, "docker", "Dockerfile.sandbox"),
  entrypoint: join(REPO_ROOT, "docker", "entrypoint.sh"),
  opencode: join(REPO_ROOT, "vendor", "opencode", "1.18.31", "opencode"),
} as { dockerfile: string; entrypoint: string; opencode: string };

export const DOCKERFILE = PATHS.dockerfile;
export const ENTRYPOINT = PATHS.entrypoint;
export const VENDORED_OPENCODE = PATHS.opencode;

/**
 * The pinned base image. Kept next to the Dockerfile so a version bump is a
 * visible diff in two places rather than a silent one.
 */
export const PINNED_BASE = "oven/bun@sha256:8956c7667fa17beb6e3c664115e66bdacfe502da5d99603626e74c197bdef160";
export const PINNED_BUN = "1.3.12";
export const PINNED_OPENCODE = "1.18.31";

export type BuildOutcome = "cached" | "built";

/** Whether the tag is already present locally. */
export async function imageExists(tag: string, runner: Runner = defaultRunner): Promise<boolean> {
  const result = await runner("docker", ["image", "inspect", tag], 30_000);
  return result.code === 0;
}

export interface BuildOptions {
  readonly force?: boolean;
  readonly onProgress?: (line: string) => void;
}

/**
 * Build the workspace image if it is not already present.
 *
 * A missing vendored binary is a hard error rather than a skipped step: a
 * container without opencode starts fine and then fails on the first real
 * task, which is far harder to diagnose.
 */
export async function ensureImage(
  config: Config,
  options: BuildOptions = {},
  runner: Runner = defaultRunner,
): Promise<{ readonly tag: string; readonly outcome: BuildOutcome }> {
  const tag = config.image;

  for (const [label, path] of [
    ["Dockerfile", PATHS.dockerfile],
    ["entrypoint", PATHS.entrypoint],
    ["vendored opencode binary", PATHS.opencode],
  ] as const) {
    if (!existsSync(path)) {
      throw new RuntimeFailure(
        `cannot build ${tag}: the ${label} is missing at ${path}. ` +
          `Run \`cod doctor\` and check the repository checkout.`,
      );
    }
  }

  if (options.force !== true && (await imageExists(tag, runner))) {
    return { tag, outcome: "cached" };
  }

  // --progress=plain keeps the output on stdout as line-oriented text that we
  // can relay. The default TTY progress bar is unreadable when piped.
  const result = await runner(
    "docker",
    [
      "build",
      "--file",
      DOCKERFILE,
      "--tag",
      tag,
      "--progress=plain",
      REPO_ROOT,
    ],
    // A cold build pulls a base image and installs apt packages; 10 minutes is
    // a ceiling, not a target.
    600_000,
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    throw new RuntimeFailure(`building ${tag} failed: ${detail}`);
  }

  return { tag, outcome: "built" };
}
