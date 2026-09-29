#!/usr/bin/env bun
/**
 * supervisor.ts — runs INSIDE the workspace container.
 * Registers every worker on Bun.cron and executes one-shot `opencode run`.
 * Docker args: bun run /workspace/supervisor.ts
 */
import { resolveCron } from "./runtime.ts";
import { runWorker } from "./agent.ts";
import type { Department, Worker } from "./types.ts";

const CONFIG_PATH = "/workspace/cod.workspace.json";
const TIMEOUT_MS = 900_000;

interface SupervisorConfig {
  readonly departments: readonly Department[];
}

function log(msg: string): void {
  process.stderr.write(`[supervisor] ${msg}\n`);
}

async function main(): Promise<void> {
  // Fails loudly on Bun < 1.3.12. A silent scheduler is the one failure mode
  // that looks healthy, so the guard is non-negotiable.
  const cron = resolveCron();

  const cfg: SupervisorConfig = await Bun.file(CONFIG_PATH).json();
  if (!Array.isArray(cfg.departments) || cfg.departments.length === 0) {
    throw new Error(`${CONFIG_PATH} has no departments`);
  }

  let registered = 0;
  for (const dept of cfg.departments) {
    for (const worker of dept.workers) {
      cron(worker.schedule, () => {
        void guarded(worker);
      });
      registered += 1;
      log(`registered ${dept.name}/${worker.name} @ ${worker.schedule}`);
    }
  }
  log(`ready: ${registered} workers on Bun ${Bun.version}`);

  // Supervisor stays foregrounded: container life == scheduler life.
  await new Promise<never>(() => {});
}

async function guarded(worker: Worker): Promise<void> {
  try {
    const r = await runWorker("self", worker, TIMEOUT_MS);
    log(`${worker.role}/${worker.name} ok in ${r.durationMs}ms`);
  } catch (err) {
    log(`${worker.role}/${worker.name} FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err: unknown) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
