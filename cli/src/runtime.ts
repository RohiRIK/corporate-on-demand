import { RuntimeFailure } from "./exit.ts";

export const MIN_BUN = "1.3.12";

type CronFn = (pattern: string, fn: () => void | Promise<void>) => unknown;

/**
 * Bun.cron is `undefined` on Bun 1.3.9 and a function on 1.3.12.
 * This guard MUST fail loudly: a silent no-op scheduler looks like a healthy
 * workspace while nothing ever runs.
 */
export function resolveCron(runtime: unknown = globalThis.Bun): CronFn {
  const bun = runtime as { cron?: unknown; version?: string } | undefined;
  const version = bun?.version ?? "unknown";
  if (typeof bun?.cron !== "function") {
    throw new RuntimeFailure(
      `Bun.cron is unavailable on Bun ${version} (need >= ${MIN_BUN})`,
      "Upgrade Bun, or run cod inside the workspace container built from oven/bun:1.3.12",
    );
  }
  return bun.cron as CronFn;
}

export function assertBunVersion(version: string = Bun.version): void {
  if (compareVersions(version, MIN_BUN) < 0) {
    throw new RuntimeFailure(
      `Bun ${version} cannot run cod (need >= ${MIN_BUN})`,
      "curl -fsSL https://bun.sh/install | bash",
    );
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
