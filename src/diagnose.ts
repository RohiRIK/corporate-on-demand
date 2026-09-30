/**
 * Turning "no detail" into an actual cause.
 *
 * opencode and Kilo both write structured logs under
 * `<data-dir>/log/*.log`, and both put a `ref=err_...` id into the JSONL error
 * event they emit. That id is the JOIN KEY: the same string appears in both
 * places, so a failure we only know by its message can be pulled back to the
 * line that says what actually went wrong.
 *
 * This is what removes `agent exited 1: no detail` - not a better error message
 * from the provider, which we do not control, but the ability to go and look.
 *
 * Deliberately bounded: one line, no whole-file reads, no throwing. A missing
 * log directory is the normal case before the first failure, and a diagnostic
 * that cannot find anything must not itself become a second failure.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** How much of a single log line is worth showing. */
const MAX_LINE = 300;

/**
 * Where the engines keep their logs.
 *
 * BOTH, not one - measured, not assumed. opencode writes under
 * `~/.local/share/opencode/log` and Kilo under `~/.local/share/kilo/log`,
 * because Kilo is a fork that kept the code and renamed the data directory.
 * Searching only opencode's meant every Kilo failure silently found nothing,
 * which is indistinguishable from there being nothing to find.
 *
 * (Kilo's own combined log file is even named `opencode.log`.)
 */
export function logDirs(): readonly string[] {
  const home = homedir();
  return [
    join(home, ".local", "share", "opencode", "log"),
    join(home, ".local", "share", "kilo", "log"),
  ];
}

/**
 * The one log line mentioning `ref`, or null.
 *
 * Returns a single line on purpose. A log can be megabytes, and a diagnostic
 * that dumps one into the operator's results line has replaced "no detail" with
 * "too much detail".
 */
export function lookupRef(ref: string, dirs: readonly string[] = logDirs()): string | null {
  if (ref === "") return null;

  for (const logDir of dirs) {
    if (!existsSync(logDir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(logDir);
    } catch {
      // An unreadable directory is the same as a missing one for our purpose.
      continue;
    }

    // Newest first, so if an id somehow appears twice the more recent
    // explanation wins. These files are timestamped, so name order is age order.
    for (const entry of entries.sort().reverse()) {
      if (!entry.endsWith(".log")) continue;
      let contents: string;
      try {
        contents = readFileSync(join(logDir, entry), "utf8");
      } catch {
        continue;
      }
      for (const line of contents.split("\n")) {
        if (line.includes(ref)) return line.trim().slice(0, MAX_LINE);
      }
    }
  }
  return null;
}

/**
 * One operator-readable sentence about a failure.
 *
 * Says "no log entry" rather than staying silent, because silence here is
 * indistinguishable from the bug this file exists to fix.
 */
export function describeDiagnostic(ref: string, dirs: readonly string[] = logDirs()): string {
  const hit = lookupRef(ref, dirs);
  if (hit === null) return `${ref}: no log entry found under ${dirs.join(", ")}`;
  return `${ref}: ${hit}`;
}
