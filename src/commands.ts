/**
 * The command table.
 *
 * Every command resolves config the same way and prints through the injected
 * `print` callback, so stdout carries data and stderr carries messages. A
 * command never calls process.exit itself; it throws, and index.ts maps the
 * error to an exit code. That is what keeps the 0/1/2 contract in one place.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ensureStateDir, ensureParentDir, type Config } from "./config";
import { RuntimeFailure, UsageError } from "./errors";
import { isDockerAvailable } from "./docker";
import {
  Workspace,
  WORKSPACE_VERSION,
  allWorkers,
  type Department,
} from "./workspace";
import { loadStarterDepartment } from "./templates";

export interface CommandFlags {
  readonly state?: string | undefined;
  readonly image?: string | undefined;
  readonly format?: string | undefined;
  readonly workspace?: string | undefined;
  readonly yes?: boolean | undefined;
  readonly json?: boolean | undefined;
  /** Override the company name; defaults to the workspace name. */
  readonly company?: string | undefined;
  /** Override the company purpose. */
  readonly purpose?: string | undefined;
  /** Rebuild the image even when it is already present. */
  readonly rebuild?: boolean | undefined;
  /** Minimum level for `cod logs`. */
  readonly level?: string | undefined;
  /** Correlate `cod logs` to one supervisor or job run. */
  readonly run?: string | undefined;
  /** Return at most this many events. */
  readonly last?: number | undefined;
}

export type Print = (config: Config, data: unknown, table: () => string) => void;

function configFrom(flags: CommandFlags): Config {
  const config = loadConfig(flags);
  if (flags.json === true && config.format !== "json") {
    return { ...config, format: "json" };
  }
  return config;
}

function readWorkspace(config: Config): Workspace {
  if (!existsSync(config.workspaceFile)) {
    throw new UsageError(
      `no workspace at ${config.workspaceFile}; run \`cod init <name>\` first`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(config.workspaceFile, "utf8"));
  } catch (error) {
    throw new UsageError(
      `${config.workspaceFile} is not valid JSON: ${(error as Error).message}`,
    );
  }
  const result = Workspace.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first ? `${first.path.join(".")}: ${first.message}` : "unknown problem";
    throw new UsageError(`${config.workspaceFile} is not a valid workspace — ${where}`);
  }
  return result.data;
}

const commands: Record<
  string,
  (positionals: string[], flags: CommandFlags, print: Print) => void | Promise<void>
> = {
  /** Define the company, its departments and its workers. */
  init(positionals, flags, print) {
    const name = positionals[0];
    if (name === undefined || name === "") {
      throw new UsageError("init needs a workspace name: `cod init <name>`");
    }
    const config = configFrom(flags);
    ensureParentDir(config.workspaceFile);
    ensureStateDir(config);

    // Non-interactive mode takes every default, so the scripted path is the
    // one the tests exercise. Prompts are added on top of it, never instead.
    const department: Department = loadStarterDepartment();
    // The workspace name doubles as the company name unless the operator
    // supplied a different one. Purpose is not guessable, so --yes gets the
    // honest placeholder rather than a fabricated description.
    const companyName = flags.company ?? name;
    const purpose = flags.purpose ?? `${companyName} workspace; edit cod.json to describe it properly`;
    const workspace: Workspace = {
      version: WORKSPACE_VERSION,
      company: { name: companyName, purpose },
      departments: [department],
      crons: [],
    };

    const parsed = Workspace.safeParse(workspace);
    if (!parsed.success) {
      throw new UsageError(`the generated workspace is invalid: ${parsed.error.message}`);
    }

    writeFileSync(config.workspaceFile, `${JSON.stringify(parsed.data, null, 2)}\n`);

    print(
      config,
      {
        workspace: config.workspaceFile,
        state: config.stateDir,
        company: parsed.data.company,
        departments: parsed.data.departments.map((d) => d.name),
        workers: allWorkers(parsed.data).map((w) => w.name),
      },
      () =>
        [
          `initialised "${parsed.data.company.name}" at ${config.workspaceFile}`,
          `  state  ${config.stateDir}`,
          `  does   ${parsed.data.company.purpose}`,
          ...parsed.data.departments.map(
            (d) =>
              `  dept   ${d.name}: ${d.workers.map((w) => `${w.name} (${w.role})`).join(", ")}`,
          ),
          "",
          "Next: cod up",
        ].join("\n"),
    );
  },

  /** Build the workspace image and start the container. */
  async up(_positionals, flags, print) {
    const config = configFrom(flags);
    const workspace = readWorkspace(config);
    if (!(await isDockerAvailable())) {
      throw new RuntimeFailure("docker is not available on this host; is the daemon running?");
    }
    const { ensureImage } = await import("./image");
    const { makeDocker } = await import("./docker");

    // Always say which case this was. A cold build takes minutes and a warm
    // one is instant; silence makes both look like a hang.
    const build = await ensureImage(config, { force: flags.rebuild === true });
    const imageNote = build.outcome === "cached" ? "cached" : "built (first run, this takes minutes)";

    const docker = makeDocker();
    const name = await docker.up(config, workspace);
    print(
      config,
      { started: name, image: build.tag, outcome: build.outcome },
      () => `image    ${build.tag} (${imageNote})\nstarted  ${name}`,
    );
  },

  /** Build the workspace image without starting anything. */
  async image(_positionals, flags, print) {
    const config = configFrom(flags);
    if (!(await isDockerAvailable())) {
      throw new RuntimeFailure("docker is not available on this host; is the daemon running?");
    }
    const { ensureImage } = await import("./image");
    const build = await ensureImage(config, { force: flags.rebuild === true });
    print(
      config,
      build,
      () =>
        build.outcome === "cached"
          ? `${build.tag} is already built`
          : `${build.tag} built`,
    );
  },

  /** Start the in-container supervisor, which registers the cron jobs. */
  async supervise(_positionals, flags, print) {
    const config = configFrom(flags);
    const { isRunning } = await import("./docker");
    if (!(await isRunning(config))) {
      throw new RuntimeFailure("the workspace container is not running; run `cod up` first");
    }
    const { containerNameFor, runSupervisor } = await import("./supervise");
    const name = containerNameFor(config);
    const result = await runSupervisor(config, name);
    print(
      config,
      result,
      () => `supervisor in ${name}: ${result.lines.length} line(s), exit ${result.code}`,
    );
    if (result.code !== 0) {
      throw new RuntimeFailure(
        `the supervisor exited ${result.code}: ${result.lines.join("; ") || "no output"}`,
      );
    }
  },

  /** Stop and remove the workspace container. */
  async down(_positionals, flags, print) {
    const config = configFrom(flags);
    if (!(await isDockerAvailable())) {
      throw new RuntimeFailure("docker is not available on this host; is the daemon running?");
    }
    const { makeDocker } = await import("./docker");
    const docker = makeDocker();
    const removed = await docker.down(config);
    print(config, { stopped: removed }, () => (removed ? "container removed" : "nothing to remove"));
  },

  /** Report container, worker and toolchain state. */
  async status(_positionals, flags, print) {
    const config = configFrom(flags);
    const workspace = readWorkspace(config);
    const { makeDocker, isRunning } = await import("./docker");
    const running = await isRunning(config);
    print(
      config,
      {
        workspace: config.workspaceFile,
        company: workspace.company.name,
        running,
        workers: allWorkers(workspace).map((w) => w.name),
        crons: workspace.crons.map((c) => c.name),
      },
      () =>
        [
          `${workspace.company.name} — ${running ? "running" : "not running"}`,
          `  workers  ${allWorkers(workspace).map((w) => w.name).join(", ") || "none"}`,
          `  crons    ${workspace.crons.map((c) => c.name).join(", ") || "none"}`,
        ].join("\n"),
    );
  },

  /** Show resolved configuration and where each value came from. */
  config(positionals, flags, print) {
    const sub = positionals[0] ?? "show";
    if (sub !== "show") {
      throw new UsageError(`unknown config subcommand "${sub}"; try \`cod config show\``);
    }
    const config = configFrom(flags);
    print(
      config,
      {
        workspaceFile: config.workspaceFile,
        stateDir: config.stateDir,
        image: config.image,
        format: config.format,
        sources: config.sources,
      },
      () =>
        [
          `workspace file  ${config.workspaceFile}`,
          `state dir       ${config.stateDir}  (${config.sources.stateDir})`,
          `image           ${config.image}  (${config.sources.image})`,
          `format          ${config.format}  (${config.sources.format})`,
        ].join("\n"),
    );
  },

  /**
   * Read the event log.
   *
   * This is the answer to "what happened". The file lives in the state
   * directory, so it survives the container: run a job, destroy the container,
   * and the record is still here.
   */
  async logs(_positionals, flags, print) {
    const config = configFrom(flags);
    const { formatEvent, readEvents } = await import("./logs");
    const events = readEvents(join(config.stateDir, "logs"), {
      level: flags.level as never,
      runId: flags.run,
      limit: flags.last,
    });
    print(
      config,
      events,
      () =>
        events.length === 0
          ? "no log events yet - is the container running?"
          : events.map((event) => formatEvent(event)).join("\n"),
    );
  },

  /** Check that the host can run a container. */
  async doctor(_positionals, flags, print) {
    const config = configFrom(flags);
    const { doctor } = await import("./docker");
    const report = await doctor(config);
    print(config, report, () =>
      [
        `docker    ${report.dockerAvailable ? `available (${report.dockerVersion})` : "NOT available"}`,
        `bun       ${report.bunVersion}`,
        `bun.cron  ${report.bunCronAvailable ? "available" : "MISSING (need 1.3.12+)"}`,
        `image     ${report.image}  (${report.imageCached ? "cached" : "not built"})`,
        `opencode  ${report.opencodeVendored ? "vendored" : "NOT vendored"}`,
        ...(report.remedy ? [`fix       ${report.remedy}`] : []),
      ].join("\n"),
    );
    if (!report.dockerAvailable) {
      throw new RuntimeFailure("docker is not available on this host");
    }
  },
};

export async function runCommand(
  command: string,
  positionals: string[],
  flags: CommandFlags,
  print: Print,
): Promise<void> {
  const handler = commands[command];
  if (handler === undefined) {
    throw new UsageError(`unknown command "${command}"; run \`cod --help\` for usage`);
  }
  await handler(positionals, flags, print);
}
