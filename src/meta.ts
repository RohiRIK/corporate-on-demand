export const NAME = "cod";
export const VERSION = "0.1.0";

export const HELP_TEXT = `
${NAME} - provision a shared container workspace for credential-free agents

USAGE:
  ${NAME} <command> [options]

COMMANDS:
  init      Define the company, its departments and its workers
  up        Build the image and start the workspace container
  down      Stop and remove the workspace container
  status    Report container, worker and toolchain state
  image     Build the workspace image without starting anything
  supervise Run the in-container cron supervisor
  logs      Read the event log — the answer to "what happened"
  results   Read persisted job results — what ran, and did it work
  purge     Remove the work volume and every commit in it (--purge confirms)
  container-name  The container and volume names this workspace will use
  meet     Hold a company meeting: every role speaks, the CEO decides, decisions become work
  cycle    Run one unattended company cycle: departments propose, then reconcile
  skills   List the agent skill bundle and check this workspace against it
  work      The work ledger: list, propose, claim, commit (--status filters the list)
  reconcile Run the CEO's reconciler once (also runs on the supervisor's tick)
  config    Show resolved configuration and where each value came from
  doctor    Check that the host can run a container
  help      Show this help

OPTIONS:
  -h, --help              Show this help
  -v, --version           Show the version
      --json              Print JSON instead of a table
      --yes               Accept every default; never prompt (for scripts)
      --rebuild           Rebuild the image even when it is already present
      --level <level>     Minimum level for cod logs: debug, info, warn, error
      --run <id>          Show only events from one run
      --last <n>          Show at most n events or results
      --cron <name>       Filter results to one job
      --failed            Show only failed runs
      --purge             Confirm the destructive volume purge
      --owner <name>     Who is claiming work
      --epoch <n>        The lease epoch being committed (the fencing token)
      --from <agent>     The proposing department
      --to <agent>       The agent a proposal addresses, or a claim filter
      --goal <text>      What the work is for
      --paths <a,b>      Comma-separated target paths (feed the novelty key)
      --blast <0|1|2>    0 self-contained, 1 cross-department, 2 global
      --reason <text>    A reason recorded with a commit or rejection
      --company <name>    Override the company name
      --purpose <text>    Override the company purpose
      --workspace <path>  Workspace file, default ./cod.json
      --state <path>      State directory, default ~/.local/share/cod
      --status <state>    Filter the work list by work status
      --image <image>     Container image tag, default ${"cod-sandbox:1.3.12"}
      --format <fmt>      table or json

EXIT CODES:
  0  success
  1  runtime failure, a retry may succeed
  2  usage failure, the same command will fail again

EXAMPLES:
  ${NAME} init acme --yes          Define a workspace with the default team
  ${NAME} up --json | jq .started  Start the container, machine-readable
  ${NAME} config show              Show config and where each value came from
  ${NAME} status                   Is the container up, and what is in it

NOTES:
  There are no credentials to configure. The agent runtime needs no API key, so
  this CLI never asks for one and never stores one.
`;
