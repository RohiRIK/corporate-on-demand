export const NAME = "cod";
export const VERSION = "0.1.0";

export const HELP_TEXT = `
${NAME} - provision a shared container workspace for credential-free agents

USAGE:
  ${NAME} <command> [options]

COMMANDS:
  init      Define the company, its departments and its workers (--force replaces an existing file)
  up        Build the image and start the workspace container
  down      Stop and remove the workspace container (keeps the work volume)
  status    Container, schedule, sandbox, blocked work and unexported landings
  image     Build the workspace image without starting anything
  supervise Show what the running supervisor registered (read-only)
  logs      Read the event log — the answer to "what happened"
  results   Read persisted job results — what ran, and did it work
  purge     Remove the work volume and every commit in it (--purge confirms)
  land      Export landed work into landing.repo as cod-landed (--force if it no longer fast-forwards)
  container-name  The container and volume names this workspace will use
  meet      Hold a company meeting: every role speaks, the CEO decides, decisions become work
  cycle     Run one company cycle: departments with nothing open plan, then reconcile
  skills    List the agent skill bundle and check this workspace against it
  work      The work ledger:
              list [--status <s>]              what is in it
              propose --from --to --goal ...   add a proposal (never runnable until reconciled)
              claim [--owner] [--to]           claim the next ready item
              commit <id> --epoch <n>          finish a claimed item (--failed, --reason)
              run <id>                         run one ready item in the container now
              blocked                          what stopped and needs a person
              unblock <id> [why] [--override]  look at a rejected item again, or re-run a failed one
  reconcile Run the CEO's reconciler once (also runs on the supervisor's tick)
  config    Show resolved configuration and where each value came from
  doctor    Check that the host can run a container
  help      Show this help

OPTIONS:
  -h, --help              Show this help
  -v, --version           Show the version
      --json              Print JSON instead of a table
      --yes               Accept every default; never prompt (for scripts)
      --force             init: replace an existing workspace file; land: replace cod-landed
      --rebuild           Rebuild the image even when it is already present
      --level <level>     Minimum level for cod logs: debug, info, warn, error
      --run <id>          Show only events from one run
      --last <n>          Show at most n events or results
      --cron <name>       Filter results to one job
      --failed            Show only failed runs; with work commit, record a failure
      --purge             Confirm the destructive volume purge
      --owner <name>      Who is claiming work
      --epoch <n>         The lease epoch being committed (the fencing token)
      --from <agent>      The proposing department
      --to <agent>        The agent a proposal addresses, or a claim filter
      --goal <text>       What the work is for
      --payload <text>    What the agent is told (defaults to the goal)
      --kind <kind>       task (default) or plan
      --paths <a,b>       Comma-separated target paths; they decide the blast radius
      --blast <0|1|2>     A declared radius: recorded, never lower than --paths imply
      --reason <text>     A reason recorded with a commit
      --override          work unblock: clear a live request for changes you checked yourself
      --company <name>    Override the company name
      --purpose <text>    Override the company purpose
      --workspace <path>  Workspace file, default ./cod.json
      --state <path>      State directory, default ~/.local/share/cod (one per workspace)
      --status <state>    Filter the work list: proposed, ready, running, done, failed, rejected
      --image <image>     Container image tag, default ${"cod-sandbox:1.3.12"}
      --format <fmt>      table or json

EXIT CODES:
  0  success
  1  runtime failure, a retry may succeed
  2  usage failure or refusal: the same command will fail again

EXAMPLES:
  ${NAME} init acme --yes          Define a workspace with the default team
  ${NAME} up --json | jq .started  Start the container, machine-readable
  ${NAME} config show              Show config and where each value came from
  ${NAME} status                   Is the container up, and what is in it

NOTES:
  There are no credentials to configure. The agent runtime needs no API key, so
  this CLI never asks for one and never stores one.
`;
