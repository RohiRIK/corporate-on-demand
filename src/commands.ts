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
import { DEFAULT_MAX_CONCURRENT } from "./limit";
import { describeTimezone, hostTimezone } from "./timezone";
import { loadConfig, ensureStateDir, ensureParentDir, type Config } from "./config";
import { RuntimeFailure, UsageError } from "./errors";
import { isDockerAvailable } from "./docker";
import {
  Workspace,
  WORKSPACE_VERSION,
  allWorkers,
  type Department,
} from "./workspace";
import { loadStarterDepartments } from "./templates";

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
  /** Filter `cod results` to one job name. */
  readonly cron?: string | undefined;
  /**
   * Internal: the in-container half of `cod work run`.
   *
   * Not a user-facing flag. It exists so the host can hand a dispatch to the
   * container, which is the only place /work and the ledger actually exist.
   * Accepted on the command line because that is how the host reaches it, and
   * it only ever does the inner half of one operation.
   */
  readonly inside?: boolean | undefined;
  /** Show only failed runs. */
  readonly failed?: boolean | undefined;
  /** Confirm a destructive `cod purge`. */
  readonly purge?: boolean | undefined;
  /** Filter a ledger listing by work status. Not --state: that is the state DIRECTORY. */
  readonly status?: string | undefined;
  /** Who is claiming. */
  readonly owner?: string | undefined;
  /** The lease epoch being committed against - the fencing token. */
  readonly epoch?: string | undefined;
  /** The proposing department. */
  readonly from?: string | undefined;
  /** The agent a proposal is addressed to, or a claim filter. */
  readonly to?: string | undefined;
  /** What the work is for. */
  readonly goal?: string | undefined;
  /** The work payload. */
  readonly payload?: string | undefined;
  /** Comma-separated target paths, which feed the novelty key. */
  readonly paths?: string | undefined;
  /** 0 self-contained, 1 cross-department, 2 global. */
  readonly blast?: string | undefined;
  /** A kind of work. */
  readonly kind?: string | undefined;
  /** A reason recorded with a commit or a rejection. */
  readonly reason?: string | undefined;
}

export type Print = (config: Config, data: unknown, table: () => string) => void;

/** Keep a column from destroying the alignment of everything after it. */
function truncate(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}\u2026`;
}

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
    // Every starter template, not one hardcoded name. A new department JSON
    // file now actually joins the company instead of sitting on disk.
    const departments: Department[] = loadStarterDepartments();
    // The workspace name doubles as the company name unless the operator
    // supplied a different one. Purpose is not guessable, so --yes gets the
    // honest placeholder rather than a fabricated description.
    const companyName = flags.company ?? name;
    const purpose = flags.purpose ?? `${companyName} workspace; edit cod.json to describe it properly`;
    // A company purpose is not guessable and must not be fabricated, so
    // --yes takes the honest placeholder and the operator edits it. That is
    // deliberate and stays.
    const workspace: Workspace = {
      version: WORKSPACE_VERSION,
      company: { name: companyName, purpose },
      departments,
      crons: [],
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      // The HOST's zone, not UTC. A new workspace should be correct without
      // the operator having to know the field exists.
      timezone: hostTimezone(),
      resultRetention: 500,
      governance: { enabled: true },
      // ON by default, and saying so in the file rather than leaving it absent:
      // a new workspace should govern itself without the operator reading this
      // comment. An operator who wants it manual sets `enabled: false`.
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

    // `up` used to report success the moment the container existed. The
    // supervisor is now PID 1, so the container can be up and the schedule
    // already broken. Wait for a live heartbeat, and report the real reason
    // if one never arrives - a bare "started" that hides a dead supervisor is
    // the exact failure this stage exists to end.
    const { formatLiveness, supervisorLiveness } = await import("./liveness");
    const deadline = Date.now() + 15_000;
    let liveness = supervisorLiveness(config.stateDir);
    while (liveness.state !== "live" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      liveness = supervisorLiveness(config.stateDir);
    }

    print(
      config,
      { started: name, image: build.tag, outcome: build.outcome, liveness: liveness.state },
      () =>
        [
          `image    ${build.tag} (${imageNote})`,
          `started  ${name}`,
          `  ${formatLiveness(liveness)}`,
        ].join("\n"),
    );

    if (liveness.state !== "live") {
      throw new RuntimeFailure(
        `the container started but the supervisor is not live (${liveness.state}); ` +
          `the schedule is not running. Check: docker logs ${name}`,
      );
    }
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
    const result = await runSupervisor(config, name, { timezone: readWorkspace(config).timezone });
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
    const { formatLiveness, supervisorLiveness } = await import("./liveness");
    const running = await isRunning(config);
    // Container state and schedule state are DIFFERENT claims. The container
    // blocks in `tail -f` and stays "up" after the supervisor dies, so a single
    // "running" line would let a dead schedule read as a healthy one.
    const liveness = supervisorLiveness(config.stateDir);
    // Ledger state is a DIFFERENT claim from container state. A status line
    // that only says "up" cannot tell an operator that three items have stopped
    // and are waiting on them.
    let blocked = 0;
    try {
      const { openWork, blockedWork } = await import("./work");
      const handle = openWork(config.stateDir);
      try {
        blocked = blockedWork(handle).length;
      } finally {
        handle.close();
      }
    } catch {
      blocked = 0;
    }
    print(
      config,
      {
        workspace: config.workspaceFile,
        company: workspace.company.name,
        running,
        liveness: liveness.state,
        supervisorJobs: liveness.heartbeat?.jobs ?? null,
        timezone: workspace.timezone,
        workers: allWorkers(workspace).map((w) => w.name),
        crons: workspace.crons.map((c) => c.name),
        blocked,
      },
      () =>
        [
          `${workspace.company.name} — container ${running ? "up" : "down"}`,
          `  ${formatLiveness(liveness)}`,
          // A cron expression means nothing without knowing which clock it
          // refers to, so the resolved zone is always on screen.
          `  timezone ${describeTimezone(workspace.timezone)}`,
          `  workers  ${allWorkers(workspace).map((w) => w.name).join(", ") || "none"}`,
          `  crons    ${workspace.crons.map((c) => c.name).join(", ") || "none"}`,
          // Ledger state is a different claim from container state. A status
          // line that only says "up" cannot tell an operator that items have
          // stopped and are waiting on them.
          `  blocked  ${blocked === 0 ? "nothing is waiting on you" : `${blocked} item(s) waiting - see \`cod work blocked\``}`,
        ].join("\n"),
    );
    // A dead supervisor is a runtime failure, not a status line to scroll past.
    if (running && liveness.state !== "live") {
      throw new RuntimeFailure(
        `the container is up but the supervisor is not live (${liveness.state}); the schedule is not running`,
      );
    }
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
   * The container and volume names this workspace will use.
   *
   * Exists so tooling - the clean-room script especially - never hardcodes a
   * name that the CLI then disagrees with. A hardcoded name is how the
   * path-derivation bug stayed hidden: the script kept passing against the one
   * workspace whose filename happened to produce the name it expected.
   */
  async "container-name"(_positionals, flags, print) {
    const config = configFrom(flags);
    const { containerNameForFile, workVolume } = await import("./docker");
    const container = containerNameForFile(config.workspaceFile);
    print(
      config,
      { container, volume: workVolume(config) },
      () => `container: ${container}\nvolume:    ${workVolume(config)}`,
    );
  },

  /**
   * The work ledger. Read-only unless a subcommand says otherwise.
   */
  async work(positionals, flags, print) {
    const config = configFrom(flags);
    const { openWork, listWork, claim, commit, propose, get } = await import("./work");
    const sub = positionals[0] ?? "list";
    const handle = openWork(config.stateDir);
    try {
      if (sub === "list") {
        // --state is the global state-DIRECTORY flag, so it cannot double as a
        // status filter. It did: "work list --state proposed" silently listed
        // nothing AND created a directory named "proposed" in the cwd. --status
        // is unambiguous and cannot collide.
        const status = typeof flags.status === "string" ? flags.status : undefined;
        const items = listWork(handle, status as never);
        print(
          config,
          items,
          () =>
            items.length === 0
              ? "work ledger is empty"
              : items
                  .map(
                    (r) =>
                      // The GOAL is included, not just the identifiers: a ledger
                      // that cannot be read to answer "is this the same work?"
                      // is useless for the one job it exists to do.
                      `${r.id}  ${r.state.padEnd(9)} ${truncate(r.payload, 48).padEnd(48)} ` +
                      `${r.from_agent} -> ${r.to_agent}` +
                      `  epoch=${r.lease_epoch} attempts=${r.attempts}` +
                      (r.blast_radius === null ? "" : `  blast=${r.blast_radius}`) +
                      (r.reason === null ? "" : `  (${truncate(r.reason, 40)})`),
                  )
                  .join("\n"),
        );
        return;
      }
      if (sub === "propose") {
        const from = flags.from ?? "engineering";
        const to = flags.to ?? from;
        const goal = flags.goal ?? "unspecified";
        const result = propose(handle, {
          from,
          to,
          kind: flags.kind ?? "task",
          payload: flags.payload ?? goal,
          goal,
          targetPaths: typeof flags.paths === "string" ? flags.paths.split(",").filter(Boolean) : [],
          blastRadius: typeof flags.blast === "string" ? Number(flags.blast) : undefined,
        });
        print(
          config,
          result,
          () =>
            result.ok && result.item !== undefined
              ? `proposed ${result.item.id} (state ${result.item.state}; it is NOT runnable until the CEO reconciles it)`
              : `refused: ${result.reason ?? "unknown"}`,
        );
        return;
      }
      if (sub === "claim") {
        const owner = flags.owner ?? "cli";
        const item = claim(handle, owner, typeof flags.to === "string" ? flags.to : undefined);
        print(
          config,
          item,
          () =>
            item === null
              ? "nothing to claim"
              : `claimed ${item.id} as ${owner} (lease_epoch ${item.lease_epoch}, attempt ${item.attempts})`,
        );
        return;
      }
      if (sub === "commit") {
        const id = positionals[1] ?? "";
        const epoch = Number(flags.epoch ?? "-1");
        const outcome = commit(handle, id, epoch, flags.failed === true ? "failed" : "done", flags.reason);
        print(
          config,
          outcome,
          () =>
            outcome.ok
              ? `committed ${id} as ${outcome.item?.state ?? "done"}`
              : `commit REFUSED: ${outcome.reason ?? "unknown"}`,
        );
        return;
      }
      if (sub === "blocked") {
        // Work that stopped and needs a person. The company is autonomous, which
        // does not mean it never halts - it means that when it halts it says so.
        // An item the reviewer rejected has no further authority to fix itself,
        // and an operator who cannot SEE it has no way to unblock it.
        const { openWork, blockedWork } = await import("./work");
        const handle = openWork(config.stateDir);
        try {
          const blocked = blockedWork(handle);
          print(
            config,
            blocked,
            () =>
              blocked.length === 0
                ? "nothing is blocked"
                : [
                    `${blocked.length} item(s) waiting on a person:`,
                    ...blocked.map(({ item, review }) => `  ${item.id}  ${review.branch}\n      ${review.reason}`),
                    "",
                    "to retry one by hand: cod work run <id>",
                  ].join("\n"),
          );
        } finally {
          handle.close();
        }
        return;
      }
      if (sub === "run" && flags.inside !== true) {
        const workId = positionals[1] ?? "";
        if (workId === "") throw new UsageError("work run needs an id: `cod work run <id>`");
        // Run a ledger item as a REAL job, not a note about one. The worktree,
        // the instruction bundle and the agent all come from the same place a
        // cron job uses, so a job run from the ledger and a job run from cron
        // are the same machine rather than two that drift apart.
        // Hand the job to the container. The ledger, the worktrees and /work all
        // live in the work VOLUME, and the host has none of them - a host-side
        // dispatch failed with "no git repository at /work", which is true and
        // useless. So the host delegates rather than pretending.
        const { makeDocker } = await import("./docker");
        const { execIn } = makeDocker();
        const result = await execIn(config, [
          "bun", "run", "/usr/local/lib/cod/run-work.js", workId, "--workspace", "/cod/cod.json", "--state", "/cod",
        ], `dispatch ${workId}`);
        if (result.code !== 0) {
          // Surfaced, not swallowed: a refusal and a failure are different
          // events and the runbook treats them differently.
          for (const line of result.out.trim().split("\n")) {
            if (line.trim() !== "") process.stderr.write(`${line}\n`);
          }
        }
        print(config, null, () => result.out.trim() || (result.code === 0 ? `${workId} dispatched` : `dispatch failed (exit ${result.code})`));
        return;
      }

      if (sub === "run" && flags["inside"] === true) {
        // The in-container half. Reached only via `cod work run --inside` from
        // the host path above, so the recursion is exactly one hop.
        const { runWorkItem } = await import("./runwork");
        const workId = positionals[1] ?? "";
        if (workId === "") throw new UsageError("work run needs an id: `cod work run <id>`");
        const workspace = readWorkspace(config);
        const item = get(handle, workId);
        if (item === null || item === undefined) {
          print(config, null, () => `no such work item: ${workId}`);
          return;
        }
        const { dispatch } = await import("./dispatch");
        const { driverFor } = await import("./drivers");
        const { acquireWorktree, releaseWorktree } = await import("./worktree");
        const { buildInstructions, writeInstructions, SKILLS_DIR } = await import("./skills");
        const worker = workspace.departments
          .flatMap((d) => d.workers)
          .find((w) => w.name === item.to_agent);
        const department = workspace.departments.find((d) => d.workers.some((w) => w.name === item.to_agent));
        const cron = { name: item.id, agent: item.to_agent, task: item.payload, schedule: "0 0 1 1 *", enabled: true, expectTools: true };
        const worktree = acquireWorktree("/work", "/work/.cod-worktrees", item.id);
        try {
          if (worker !== undefined && department !== undefined) {
            writeInstructions(worktree.path, buildInstructions(department, worker, { name: item.id, task: item.payload }, 0, SKILLS_DIR));
          }
          const result = await runWorkItem({
            stateDir: config.stateDir,
            workId,
            cron,
            driver: driverFor(worker ?? null, workspace.company, { workdir: worktree.path }),
          });
          print(
            config,
            result,
            () => result.ok
              ? `ran ${workId} (radius ${result.radius ?? "?"}): ${(result.output ?? "").slice(0, 200)}`
              : `${workId} REFUSED: ${result.reason ?? "unknown"}`,
          );
        } finally {
          releaseWorktree("/work", worktree);
        }
        return;
      }
      throw new UsageError(`unknown work subcommand "${sub}"; try list, propose, claim, commit, run or blocked`);
    } finally {
      handle.close();
    }
  },

  /**
   * Hold a company meeting.
   *
   * Every role speaks with a position about its OWN work, the CEO decides, and
   * the decisions become ledger items. The version this replaces printed a
   * derived table - which the roadmap had already named as "not a meeting", and
   * which then happened anyway.
   *
   * Deterministic, and labelled as such in the output: no agent is called and
   * no model is consulted. It decides real work from real state, which makes it
   * a first version rather than a discussion. Turning the positions into model
   * calls is the next step, and saying so here stops it being mistaken for one.
   */
  async meet(_positionals, flags, print) {
    const config = configFrom(flags);
    const workspace = readWorkspace(config);
    const { holdMeeting } = await import("./meeting");
    const meeting = await holdMeeting(workspace, config.stateDir);
    print(
      config,
      meeting,
      () => [
        `cast: ${meeting.cast.map((c) => c.name).join(", ")}`,
        "",
        ...meeting.speaking.map((s) => `  ${s.role.padEnd(12)} ${s.position}`),
        "",
        ...(meeting.decisions.length === 0
          ? ["decisions: none - nothing was waiting on the CEO"]
          : [
              `decisions: ${meeting.decisions.length}`,
              ...meeting.decisions.map((d) => `  ${d.verdict.padEnd(8)} ${d.item}  ${d.reason}`),
            ]),
        "",
        "deterministic: no model was consulted. Run `cod cycle` to propose, `cod work run <id>` to dispatch.",
      ].join("\n"),
    );
  },

  /**
   * List the skills the bundle ships, and check this workspace against them.
   *
   * Exists because a skill name that does not resolve used to degrade silently:
   * the agent ran with no rule at all and nothing on the surface said why. For a
   * company with nobody watching, a quietly missing rule looks exactly like
   * compliance.
   */
  async skills(_positionals, flags, print) {
    const config = configFrom(flags);
    const workspace = readWorkspace(config);
    const { availableSkills, auditWorkspaceSkills, resolveSkillsRoot } = await import("./skills");
    const available = availableSkills(resolveSkillsRoot());
    const audit = auditWorkspaceSkills(workspace);
    print(
      config,
      { available, ...audit },
      () => [
        `${available.length} skill(s) in the bundle (skills/agent/):`,
        ...available.map((name) => `  ${name}`),
        "",
        audit.known.length > 0 ? `in use: ${audit.known.join(", ")}` : "in use: nothing",
        ...(audit.untouched.length > 0
          ? [`workers with no skills: ${audit.untouched.join(", ")} (legal, but usually a gap)`]
          : []),
        ...(audit.unknown.length > 0
          ? ["", `UNKNOWN - these will be silently skipped at dispatch:`, ...audit.unknown.map((u) => `  ${u}`)]
          : []),
        ...(available.length === 0 ? ["", "The bundle is empty. Copy templates/skills/_TEMPLATE.md to make one."] : []),
      ].join("\n"),
    );
  },

  /**
   * Run one full company cycle: departments propose, then the ledger reconciles.
   *
   * This is what makes the company unattended. Until it existed, `propose()`
   * had exactly one caller - a human typing a CLI command - so the ledger, the
   * fencing and the novelty guard were all real and all starved.
   */
  async cycle(_positionals, flags, print) {
    const config = configFrom(flags);
    const workspace = readWorkspace(config);
    const { runCycle } = await import("./cycle");
    const result = runCycle(workspace, config.stateDir, { actor: "cycle" });
    print(
      config,
      result,
      () => [
        result.summary,
        ...result.proposed.map((p) => `  proposed  ${p.from} -> ${p.to}  ${p.goal}`),
        ...(result.proposed.length === 0 ? ["  (every department already has this outstanding)"] : []),
      ].join("\n"),
    );
  },

  /**
   * Run the reconciler once. Also runs on the supervisor's own tick; this is
   * the same function, so what you see here is exactly what the CEO does.
   */
  async reconcile(_positionals, flags, print) {
    const config = configFrom(flags);
    const { reconcileOnce, formatReport } = await import("./reconcile");
    const report = reconcileOnce({ stateDir: config.stateDir, actor: "cli" });
    print(config, report, () => formatReport(report).join("\n"));
  },

  /**
   * Remove a workspace's work volume, and everything committed in it.
    *
    * The counterpart to `down`, which deliberately KEEPS the volume so an
    * agent's commits survive a restart. Refuses without `--purge`, because the
    * difference between the two is closing a laptop and throwing it away.
    */
   async purge(_positionals, flags, print) {
     const config = configFrom(flags);
     const { purgeVolume } = await import("./purge");
     // `down` before `purge`: Docker refuses to remove a volume a container is
     // still using, and the container is normally still up - that is the whole
     // reason the volume exists.
     const { makeDocker } = await import("./docker");
     const stopIfRunning = async (): Promise<boolean> => makeDocker().down(config);
     const result = await purgeVolume(config.workspaceFile, {
       confirmed: flags.purge === true,
       stop: stopIfRunning,
     });
     print(
       config,
       result,
       () => {
         if (!result.removed) return `left ${result.volume} alone: ${result.reason ?? "unknown reason"}`;
         const stopped = result.stopped === true ? " (stopped the container first)" : "";
         return `removed ${result.volume} and every commit in it${stopped}`;
       },
     );
   },

   /** Read the event log.
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

  /**
   * Read persisted job results.
   *
   * The structured counterpart to `cod logs`: what ran, when, and whether it
   * worked. Readable long after the container that produced it is gone.
   */
  async results(_positionals, flags, print) {
    const config = configFrom(flags);
    const { formatResult, listResults } = await import("./results");
    const results = listResults(config.stateDir, {
      limit: flags.last,
      cron: flags.cron,
      onlyFailed: flags.failed,
    });
    print(
      config,
      results,
      () =>
        results.length === 0
          ? "no results yet - have any jobs run?"
          : results.map((result) => formatResult(result)).join("\n"),
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
