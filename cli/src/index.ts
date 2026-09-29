#!/usr/bin/env bun
/**
 * cod — one Docker container per workspace, credential-free opencode agents.
 *
 * Tier 1 CLI: node:util parseArgs, zero runtime dependencies.
 * Exit codes: 0 ok | 1 runtime | 2 usage. --json keeps data on stdout,
 * logs on stderr, so `cod ps --json | jq` always parses.
 */
import { parseArgs } from "node:util";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE, RuntimeFailure, UsageError } from "./exit.ts";
import { loadWorkspaceConfig, resolveConfig, workspaceDir, writeWorkspaceConfig } from "./config.ts";
import { assertBunVersion } from "./runtime.ts";
import { assertDocker, down, logs, ps, up } from "./docker.ts";
import { scaffold } from "./scaffold.ts";
import type { CodCommand, WorkspaceConfig } from "./types.ts";

const VERSION = "0.1.0";

const COMMANDS: readonly CodCommand[] = [
  "init",
  "up",
  "down",
  "ps",
  "logs",
  "doctor",
  "help",
  "version",
];

function out(data: unknown, json: boolean): void {
  if (json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else for (const line of String(data).split("\n")) process.stderr.write(`${line}\n`);
}

function showHelp(): void {
  process.stderr.write(
    `cod ${VERSION} — container-per-workspace opencode agents

USAGE
  cod <command> [options]

COMMANDS
  init <name>     Scaffold a workspace (company + departments + starter workers)
  up <name>       Start the workspace container and its Bun.cron scheduler
  down <name>     Stop and remove the workspace container
  ps              List workspace containers
  logs <name>     Tail the supervisor log
  doctor          Verify Docker, Bun version, and Bun.cron availability

OPTIONS
  -h, --help      Show this help
  -v, --version   Show version
      --json      Machine-readable output on stdout (logs stay on stderr)
      --image     Override the container image
      --model     Override the default agent model
      --tail N    Log lines to show (logs, default 100)
      --yes       Accept defaults in init (non-interactive)

EXAMPLES
  cod init acme --yes
  cod up acme
  cod ps --json | jq '.[].name'
  cod doctor
`,
  );
}

function showVersion(): void {
  process.stderr.write(`cod ${VERSION}\n`);
}

async function main(): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        json: { type: "boolean", default: false },
        image: { type: "string" },
        model: { type: "string" },
        tail: { type: "string" },
        yes: { type: "boolean", default: false },
      },
    }));
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write('Run "cod --help" for usage information.\n');
    return EXIT_USAGE;
  }

  // -v must beat the bare `cod` help fallback, so check it first.
  if (values.version === true) {
    showVersion();
    return EXIT_OK;
  }
  if (values.help === true || positionals.length === 0) {
    showHelp();
    return EXIT_OK;
  }

  const command = positionals[0] ?? "";
  if (!COMMANDS.includes(command as CodCommand)) {
    process.stderr.write(`Error: Unknown command '${command}'\n`);
    process.stderr.write('Run "cod --help" for usage information.\n');
    return EXIT_USAGE;
  }

  const json = values.json === true;
  const cwd = process.cwd();
  const str = (v: string | boolean | undefined): string | undefined => (typeof v === "string" ? v : undefined);
  const cfg = resolveConfig(cwd, {
    ...(str(values.image) !== undefined ? { image: str(values.image) } : {}),
    ...(str(values.model) !== undefined ? { defaultModel: str(values.model) } : {}),
  });

  try {
    switch (command as CodCommand) {
      case "help":
        showHelp();
        return EXIT_OK;
      case "version":
        showVersion();
        return EXIT_OK;

      case "init": {
        const name = positionals[1];
        if (name === undefined) throw new UsageError("init requires a workspace name");
        const ws = await scaffold(name, cfg, values.yes === true);
        const dir = workspaceDir(cfg.workspaceRoot, name);
        writeWorkspaceConfig(`${dir}/cod.workspace.json`, ws);
        writeSupervisor(dir);
        out({ workspace: name, path: dir, departments: ws.company.departments.length }, json);
        return EXIT_OK;
      }

      case "up": {
        const name = requireName(positionals[1], "up");
        const dir = workspaceDir(cfg.workspaceRoot, name);
        const ws = loadWorkspaceConfig(`${dir}/cod.workspace.json`);
        assertDocker();
        const container = await up(cfg, ws);
        out({ workspace: name, container, status: "started" }, json);
        return EXIT_OK;
      }

      case "down": {
        const name = requireName(positionals[1], "down");
        await down(cfg, name, true);
        out({ workspace: name, status: "removed" }, json);
        return EXIT_OK;
      }

      case "ps": {
        assertDocker();
        out(await ps(), json);
        return EXIT_OK;
      }

      case "logs": {
        const name = requireName(positionals[1], "logs");
        const tail = values.tail !== undefined ? Number(values.tail) : 100;
        if (!Number.isInteger(tail) || tail <= 0) throw new UsageError("--tail must be a positive integer");
        process.stderr.write(await logs(cfg, name, tail));
        return EXIT_OK;
      }

      case "doctor": {
        const report = await doctor();
        out(report, json);
        return report.ok ? EXIT_OK : EXIT_RUNTIME;
      }
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.stderr.write('Run "cod --help" for usage information.\n');
      return EXIT_USAGE;
    }
    if (err instanceof RuntimeFailure) {
      process.stderr.write(`Error: ${err.message}\n`);
      if (err.hint !== undefined) process.stderr.write(`Hint: ${err.hint}\n`);
      return EXIT_RUNTIME;
    }
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_RUNTIME;
  }
}

function requireName(name: string | undefined, cmd: string): string {
  if (name === undefined || name === "") throw new UsageError(`${cmd} requires a workspace name`);
  return name;
}

async function doctor(): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  let ok = true;

  checks.push({ name: "bun", ok: true, detail: `v${Bun.version}` });
  try {
    assertBunVersion();
  } catch (err) {
    ok = false;
    checks[0] = { name: "bun", ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  try {
    assertDocker();
    checks.push({ name: "docker", ok: true, detail: "daemon reachable" });
  } catch (err) {
    ok = false;
    checks.push({ name: "docker", ok: false, detail: err instanceof Error ? err.message : String(err) });
  }

  const hasCron = typeof (Bun as { cron?: unknown }).cron === "function";
  if (!hasCron) ok = false;
  checks.push({
    name: "Bun.cron",
    ok: hasCron,
    detail: hasCron ? "available" : "MISSING on this Bun — scheduler cannot run here",
  });

  return { ok, checks };
}

function writeSupervisor(dir: string): void {
  Bun.write(`${dir}/supervisor.ts`, Bun.file(new URL("./supervisor.ts", import.meta.url)));
}

process.exit(await main());
