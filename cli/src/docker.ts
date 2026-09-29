import { RuntimeFailure } from "./exit.ts";
import type { ResolvedConfig } from "./config.ts";
import type { WorkspaceConfig } from "./types.ts";

async function docker(args: string[], capture: boolean): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["docker", ...args], {
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    capture ? new Response(proc.stdout).text() : Promise.resolve(""),
    capture ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function assertDocker(): Promise<void> {
  const r = await docker(["info", "--format", "{{.ServerVersion}}"], true);
  if (r.exitCode !== 0) {
    throw new RuntimeFailure(
      "Docker daemon is not reachable",
      "Start Docker, or add your user to the docker group.",
    );
  }
}

export function containerName(cfg: ResolvedConfig, workspace: string): string {
  return `${cfg.namePrefix}-${workspace}`;
}

/** ONE container per workspace. Long-lived, runs the in-container supervisor. */
export async function up(cfg: ResolvedConfig, ws: WorkspaceConfig): Promise<string> {
  const name = containerName(cfg, ws.name);
  const running = await inspect(name);
  if (running) return name;
  const r = await docker(
    [
      "run",
      "-d",
      "--name",
      name,
      "--label",
      "cod.workspace",
      ws.name,
      "-v",
      `${ws.name}:/workspace`,
      "-w",
      "/workspace",
      cfg.image,
      "bun",
      "run",
      "/workspace/supervisor.ts",
    ],
    true,
  );
  if (r.exitCode !== 0) {
    throw new RuntimeFailure(
      `Failed to start container ${name}`,
      r.stderr.trim() || "Run `cod doctor`.",
    );
  }
  return name;
}

export async function down(cfg: ResolvedConfig, workspace: string, remove: boolean): Promise<void> {
  const name = containerName(cfg, workspace);
  const args = ["rm", remove ? "-f" : "-f", name];
  const r = await docker(args, true);
  if (r.exitCode !== 0) throw new RuntimeFailure(`Failed to remove ${name}: ${r.stderr.trim()}`);
}

export async function ps(): Promise<Array<{ name: string; status: string; image: string }>> {
  const r = await docker(
    ["ps", "-a", "--filter", "label=cod.workspace", "--format", "{{.Names}}\t{{.Status}}\t{{.Image}}"],
    true,
  );
  if (r.exitCode !== 0) throw new RuntimeFailure("docker ps failed", r.stderr.trim());
  return r.stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const [name = "", status = "", image = ""] = line.split("\t");
      return { name, status, image };
    });
}

export async function logs(cfg: ResolvedConfig, workspace: string, tail: number): Promise<string> {
  const r = await docker(["logs", "--tail", String(tail), containerName(cfg, workspace)], true);
  if (r.exitCode !== 0) throw new RuntimeFailure(`docker logs failed: ${r.stderr.trim()}`);
  return r.stdout;
}

async function inspect(name: string): Promise<boolean> {
  const r = await docker(["inspect", "--type", "container", name], true);
  return r.exitCode === 0;
}
