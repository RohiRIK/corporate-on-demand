import { RuntimeFailure } from "./exit.ts";
import type { Worker } from "./types.ts";

export interface RunResult {
  readonly worker: string;
  readonly role: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * One-shot `opencode run` is the ONLY supported invocation.
 * `opencode serve` + `run --attach` returns a healthy 200 health check while
 * emitting zero step_finish events (verified: 3 attempts) — it is a silent
 * no-op and must never be used.
 */
export async function runWorker(
  container: string,
  worker: Worker,
  timeoutMs: number,
): Promise<RunResult> {
  if (container === "") throw new RuntimeFailure("runWorker: empty container name");
  const started = Date.now();
  const argv = [
    "exec",
    container,
    "opencode",
    "run",
    "--model",
    worker.model,
    buildPrompt(worker),
  ];
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (exitCode !== 0) {
    throw new RuntimeFailure(
      `opencode run failed for ${worker.name} (exit ${exitCode})`,
      stderr.trim().slice(0, 500) || "Check `cod logs` for container output.",
    );
  }
  return {
    worker: worker.name,
    role: worker.role,
    exitCode,
    durationMs: Date.now() - started,
    stdout,
    stderr,
  };
}

function buildPrompt(worker: Worker): string {
  return `You are the ${worker.role} for this workspace. Stay in your lane. Report findings, do not escalate scope.`;
}
