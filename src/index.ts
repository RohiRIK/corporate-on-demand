#!/usr/bin/env bun
/**
 * cod — provision a shared container workspace for credential-free agents.
 *
 * CLI-First Architecture: deterministic output, JSON on stdout that pipes to
 * jq, diagnostics on stderr, and an exit code that says whether retrying is
 * worth anything. See src/errors.ts for the 0/1/2 contract.
 */

import { parseArgs } from "node:util";
import { runCommand } from "./commands";
import { CodError, UsageError } from "./errors";
import { HELP_TEXT, VERSION } from "./meta";

/**
 * `print` writes to stdout when the data is the product, and to stderr when it
 * is a message for a human. Mixing them is what makes a CLI unpipeable.
 */
function print(config: { format: string }, data: unknown, table: () => string): void {
  const body = config.format === "json" ? `${JSON.stringify(data, null, 2)}\n` : `${table()}\n`;
  process.stdout.write(body);
}

function fail(error: unknown): never {
  if (error instanceof CodError) {
    process.stderr.write(`cod: ${error.message}\n`);
    process.exit(error.exitCode);
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cod: ${message}\n`);
  process.exit(1);
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      json: { type: "boolean" },
      state: { type: "string" },
      image: { type: "string" },
      format: { type: "string" },
      workspace: { type: "string" },
      yes: { type: "boolean" },
    },
  });

  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const command = positionals[0];
  if (values.help || command === undefined || command === "help") {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }

  const flags = {
    state: values.state,
    image: values.image,
    format: values.format,
    workspace: values.workspace,
    yes: values.yes,
    json: values.json,
  };

  await runCommand(command, positionals.slice(1), flags, print);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`cod: ${error.message}\n`);
    process.stderr.write(`Run \`cod --help\` for usage.\n`);
    process.exit(2);
  }
  fail(error);
}
