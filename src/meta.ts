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
  config    Show resolved configuration and where each value came from
  doctor    Check that the host can run a container
  help      Show this help

OPTIONS:
  -h, --help              Show this help
  -v, --version           Show the version
      --json              Print JSON instead of a table
      --yes               Accept every default; never prompt (for scripts)
      --rebuild           Rebuild the image even when it is already present
      --company <name>    Override the company name
      --purpose <text>    Override the company purpose
      --workspace <path>  Workspace file, default ./cod.json
      --state <path>      State directory, default ~/.local/share/cod
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
