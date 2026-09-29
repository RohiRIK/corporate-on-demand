/**
 * Exit code contract. Never invent a fourth code.
 *   0 = success
 *   1 = runtime failure (docker, opencode, cron, IO)
 *   2 = usage error (bad flags, unknown command, missing required arg)
 */
export const EXIT_OK = 0;
export const EXIT_RUNTIME = 1;
export const EXIT_USAGE = 2;

export class UsageError extends Error {
  readonly code: number = EXIT_USAGE;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class RuntimeFailure extends Error {
  readonly code: number = EXIT_RUNTIME;
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "RuntimeFailure";
    this.hint = hint;
  }
}
