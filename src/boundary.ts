/**
 * The boundary between what an agent was TOLD and what it actually DID.
 *
 * An instruction in AGENTS.md is a request, not a control. The only thing that
 * can be enforced is the set of files that changed on disk, so everything here
 * judges paths - never the agent's own account of what it did. A check against
 * a self-report is the same trap as asking a job to "reply with exactly X" and
 * then grepping the output for X: it passes against a job that did nothing.
 *
 * Blast radius 2 is GLOBAL work. It is refused and the offending files are
 * named, because a refusal that does not say what was wrong is not actionable.
 * The commit is not made, and the worktree is NOT released, so the work
 * survives for whoever resolves it - the same "keep the work, refuse the
 * landing" rule `releaseWorktree` follows.
 */

/**
 * Paths that are global by construction.
 *
 * Matched with a segment boundary, not a bare prefix: "srcs/" is not "src/"
 * and "myops/" is not "ops/". A prefix match without the boundary refuses
 * honest work, which is how a safety check becomes an obstacle people route
 * around.
 */
const GLOBAL_PREFIXES = [
  "src/",
  "docker/",
  "ops/",
  "templates/",
  ".github/",
  "scripts/",
] as const;

/** Single files that are global on their own. */
const GLOBAL_FILES = ["package.json", "verify.sh", "bun.lock", "tsconfig.json", ".gitignore"] as const;

/**
 * Files that are global WHEREVER they sit, because they change what git itself
 * does rather than what the project contains.
 *
 * `.gitattributes` names diff, merge and filter drivers - the configured half of
 * those lives in git config, and the attributes file is how a branch points git
 * at one. `.gitmodules` makes git fetch a URL of the branch's choosing. Both
 * are a few ordinary-looking lines that no secret or path scan noticed
 * (SEC-02/SEC-03), and an attributes file in a subdirectory applies to that
 * subdirectory, so a top-level-only rule would miss most of them.
 */
const GLOBAL_BASENAMES = [".gitattributes", ".gitmodules"] as const;

/** Radius 2 and above is global. Lower radii are department or self-contained. */
export const GLOBAL_RADIUS = 2;

/** Strip a leading ./ or an absolute /work/ prefix, then normalise separators. */
function normalise(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/work\//, "")
    .replace(/^\//, "");
}

/** Is this one path global? */
export function isGlobalPath(path: string): boolean {
  const p = normalise(path);
  if ((GLOBAL_FILES as readonly string[]).includes(p)) return true;
  const base = p.split("/").pop() ?? p;
  if ((GLOBAL_BASENAMES as readonly string[]).includes(base)) return true;
  return GLOBAL_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** Does this change set exceed its declared radius? */
export function radiusExceeded(changedPaths: readonly string[], radius: number): boolean {
  if (radius < GLOBAL_RADIUS) return false;
  return changedPaths.some(isGlobalPath);
}

export interface ClassifiedChange {
  readonly changed: readonly string[];
  readonly global: readonly string[];
  readonly exceeded: boolean;
  readonly radius: number;
}

/** Split a change set into what changed and what was out of bounds. */
export function classifyChange(changedPaths: readonly string[], radius: number): ClassifiedChange {
  const changed = [...changedPaths];
  const global = changed.filter(isGlobalPath);
  return { changed, global, exceeded: radiusExceeded(changed, radius), radius };
}

/** One line a human can read, naming the offending files. */
export function summariseChange(change: ClassifiedChange): string {
  if (change.changed.length === 0) return "no files changed";
  const files = `${change.changed.length} file${change.changed.length === 1 ? "" : "s"} changed`;
  if (change.global.length === 0) return files;
  return `${files}; GLOBAL work not committed: ${change.global.join(", ")} (radius ${change.radius} may not touch these)`;
}
