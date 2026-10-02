/**
 * Landed work, out of the container - without giving the container the host.
 *
 * Landing used to bind-mount the operator's repository READ-WRITE at /landing
 * and push from it. That was wrong twice:
 *
 *   - it pushed /landing's OWN HEAD (`git -C /landing push origin HEAD:...`),
 *     not the work that had just been merged in /work, so the merged work never
 *     left the volume; and the push needed the host's credentials, which a
 *     credential-free container does not have;
 *   - a writable host repository is a host-execution path: an agent could plant
 *     a hook or a `core.fsmonitor` in its `.git`, and the operator's next
 *     `git status` there would run it, as the operator (SEC-04 B).
 *
 * Now nothing on the host is writable from the container except the state
 * directory, which agents cannot reach (src/sandbox.ts). After every landing the
 * supervisor writes the base branch as a git BUNDLE into the state directory,
 * and `cod land`, run on the host, fetches it into `landing.repo` as
 * `refs/heads/cod-landed`:
 *
 *   - a bundle is data: fetching one runs nothing from it. Every object is
 *     re-hashed as it is indexed and checked by `git fsck --strict` in a
 *     throwaway repository first, which is also what catches an object an
 *     agent damaged in the shared store;
 *   - FAST-FORWARD ONLY: history that no longer descends from what was exported
 *     before is refused, and saying so is the point. `--force` takes it anyway;
 *   - pushing `cod-landed` onward is the operator's own act, with the operator's
 *     own credentials, on the operator's machine.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitOut, runGit } from "./git";
import { checkLandingRepo } from "./landing";

export const EXPORT_DIR = "export";
export const BUNDLE_FILE = "landed.bundle";
export const MANIFEST_FILE = "landed.json";
export const LANDED_REF = "refs/heads/cod-landed";

export interface LandedManifest {
  readonly base: string;
  readonly sha: string;
  readonly at: number;
}

export function exportPaths(stateDir: string): { readonly dir: string; readonly bundle: string; readonly manifest: string } {
  const dir = join(stateDir, EXPORT_DIR);
  return { dir, bundle: join(dir, BUNDLE_FILE), manifest: join(dir, MANIFEST_FILE) };
}

/**
 * Write the base branch as a bundle, in the container, after a landing.
 *
 * tmp + rename, so `cod land` never reads half a bundle. Returns null on
 * success and the reason otherwise; it never throws, because a merge that
 * already happened must not be reported as failed because its export did.
 */
export function writeLandedBundle(repo: string, base: string, stateDir: string): string | null {
  const paths = exportPaths(stateDir);
  try {
    mkdirSync(paths.dir, { recursive: true });
    const sha = gitOut(repo, ["rev-parse", "--verify", `refs/heads/${base}`]);
    if (sha === null || sha === "") return `no branch ${base} to export`;
    const tmp = `${paths.bundle}.tmp`;
    const made = runGit(repo, ["bundle", "create", tmp, `refs/heads/${base}`], 300_000);
    if (!made.ok) return `git bundle failed: ${made.err.split("\n")[0] ?? "no detail"}`;
    renameSync(tmp, paths.bundle);
    const manifest: LandedManifest = { base, sha, at: Date.now() };
    writeFileSync(`${paths.manifest}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    renameSync(`${paths.manifest}.tmp`, paths.manifest);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

export function readManifest(stateDir: string): LandedManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(exportPaths(stateDir).manifest, "utf8")) as Partial<LandedManifest>;
    if (typeof parsed.base !== "string" || typeof parsed.sha !== "string") return null;
    return { base: parsed.base, sha: parsed.sha, at: typeof parsed.at === "number" ? parsed.at : 0 };
  } catch {
    return null;
  }
}

/** What `refs/heads/cod-landed` points at in the landing repo, or null. */
export function exportedSha(landingRepo: string): string | null {
  try {
    return execFileSync("git", ["-C", landingRepo, "rev-parse", "--verify", "--quiet", LANDED_REF], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export interface ImportResult {
  readonly ok: boolean;
  readonly sha?: string;
  readonly reason: string;
}

/**
 * Fetch the latest landed bundle into the landing repository, on the HOST.
 *
 * Runs git in the operator's own repository, with the operator's own config:
 * that repository is trusted, and the bundle - the only thing from the
 * container - is data that git verifies object by object.
 */
export function importLanded(stateDir: string, landingRepo: string, options: { readonly force?: boolean } = {}): ImportResult {
  const check = checkLandingRepo(landingRepo);
  if (!check.ok) return { ok: false, reason: check.reason ?? "landing.repo is unusable" };
  const manifest = readManifest(stateDir);
  const paths = exportPaths(stateDir);
  if (manifest === null || !existsSync(paths.bundle)) {
    return { ok: false, reason: "nothing has landed yet - there is no bundle to export" };
  }
  if (exportedSha(landingRepo) === manifest.sha) {
    return { ok: true, sha: manifest.sha, reason: `already exported: ${LANDED_REF} is ${manifest.sha.slice(0, 12)}` };
  }
  const verified = verifyBundle(paths.bundle, manifest.base);
  if (verified !== null) return { ok: false, reason: `refused: the landed bundle failed verification - ${verified}. Nothing was changed.` };
  const refspec = `${options.force === true ? "+" : ""}refs/heads/${manifest.base}:${LANDED_REF}`;
  try {
    execFileSync(
      "git",
      ["-C", landingRepo, "-c", "transfer.fsckObjects=true", "-c", "fetch.fsckObjects=true", "fetch", "--no-tags", "--no-write-fetch-head", paths.bundle, refspec],
      { encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? "").trim();
    const nonFastForward = /non-fast-forward|rejected/i.test(stderr);
    return {
      ok: false,
      reason: nonFastForward
        ? `refused: the landed history no longer descends from ${LANDED_REF} (was the work volume purged?). ` +
          "Nothing was changed. `cod land --force` replaces the ref."
        : `git fetch from the bundle failed: ${stderr.split("\n").slice(-1)[0] ?? "no detail"}`,
    };
  }
  return { ok: true, sha: manifest.sha, reason: `exported ${manifest.base} at ${manifest.sha.slice(0, 12)} to ${LANDED_REF}` };
}

/**
 * Check every object in the bundle before any of it reaches the landing repo.
 *
 * `transfer.fsckObjects` would be the obvious tool, and git 2.43 IGNORES it for
 * a bundle fetch - measured: a hand-made commit with no author email imported
 * cleanly with it set. So the bundle is first fetched into a throwaway bare
 * repository that holds nothing else, and `git fsck --strict` runs there, where
 * "the whole repository" means exactly the objects that came from the container.
 * Null when the bundle is sound, the first problem otherwise.
 */
export function verifyBundle(bundle: string, base: string): string | null {
  const quarantine = mkdtempSync(join(tmpdir(), "cod-land-verify-"));
  try {
    const init = runGit(quarantine, ["init", "--bare", "-q", "."]);
    if (!init.ok) return `could not create a scratch repository: ${init.err}`;
    const fetched = runGit(quarantine, ["fetch", "--no-tags", "--no-write-fetch-head", bundle, `+refs/heads/${base}:refs/heads/verify`], 300_000);
    if (!fetched.ok) return (fetched.err.split("\n").filter((l) => l.trim() !== "").pop() ?? "the bundle could not be read");
    const fsck = runGit(quarantine, ["fsck", "--strict", "--no-dangling", "--no-progress"], 300_000);
    if (!fsck.ok) return (`${fsck.err}\n${fsck.out}`.split("\n").find((l) => l.trim() !== "") ?? "git fsck failed");
    return null;
  } finally {
    rmSync(quarantine, { recursive: true, force: true });
  }
}

/** Remove the export, for `cod purge`: the bundle holds every commit the volume did. */
export function removeExport(stateDir: string): void {
  rmSync(exportPaths(stateDir).dir, { recursive: true, force: true });
}
