/**
 * Error types and the exit-code contract.
 *
 * Three codes, because a caller needs to tell "fix your invocation" apart from
 * "that failed and would fail again" apart from "that failed, retry later":
 *
 *   0  success
 *   1  runtime failure — something went wrong that may succeed on a retry
 *      (a Docker daemon that was restarting, a network blip)
 *   2  usage failure — the same command will fail identically forever, so
 *      retrying is wasted work (a missing flag, an unknown command)
 *
 * The distinction earns its keep in the scheduled-cron path: a job that exits
 * 1 should be retried, a job that exits 2 should be reported and left alone.
 */

/** Base class for every error this CLI raises deliberately. */
export abstract class CodError extends Error {
  abstract readonly exitCode: 0 | 1 | 2;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The invocation is wrong. Retrying the same command cannot help. */
export class UsageError extends CodError {
  override readonly exitCode = 2;
}

/** Something failed at runtime. A retry may succeed. */
export class RuntimeFailure extends CodError {
  override readonly exitCode = 1;
}

/**
 * The ledger said no: a fenced commit, a duplicate proposal, an unblock that
 * would skip a live objection.
 *
 * Exit 2, because the same command will be refused again. These used to exit
 * 0 - "commit REFUSED" on stdout and success on the exit code - so a script
 * that checked `$?` was told a fenced commit had landed. Not a UsageError: the
 * invocation was fine, and "run cod --help" is the wrong advice for a refusal.
 */
export class RefusedError extends CodError {
  override readonly exitCode = 2;
}

/**
 * `Bun.cron` does not exist below Bun 1.3.12.
 *
 * This is its own class because the failure it prevents is the worst kind: a
 * scheduler that silently never fires while reporting itself healthy. The
 * guard is loud on purpose.
 */
export class UnsupportedRuntimeError extends CodError {
  override readonly exitCode = 2;

  constructor(
    readonly required: string,
    readonly installed: string,
  ) {
    super(
      `this command needs ${required}, but ${installed} is running. ` +
        `Bun.cron is unavailable below Bun 1.3.12, so no job would ever fire. ` +
        `Install a newer Bun (mise install bun@1.3.12) and re-run.`,
    );
  }
}
