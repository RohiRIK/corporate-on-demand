/**
 * Timezone.
 *
 * Docker defaults a container to UTC. `Bun.cron` fires on LOCAL time. Nothing
 * set a zone, so every schedule in every container was silently shifted from the
 * operator's wall clock - measured on this host as 3 hours, and it would have
 * run the wrong thing and reported success.
 *
 * A cron expression with no visible clock is not interpretable, so the resolved
 * zone is surfaced in `cod status` and `cod supervise` rather than being an
 * invisible setting.
 */

import { UsageError } from "./errors";

/** The default, and what a container gets when nothing is configured. */
export const DEFAULT_TIMEZONE = "UTC";

/**
 * Whether `Intl` recognises the zone.
 *
 * Validated rather than trusted: an unrecognised zone silently behaving as UTC
 * is the exact bug this module exists to remove, so it is rejected up front.
 */
export function isValidTimezone(zone: string): boolean {
  if (zone === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Validate or throw, naming the offending value. */
export function requireTimezone(zone: string): string {
  if (!isValidTimezone(zone)) {
    throw new UsageError(
      `"${zone}" is not a valid IANA timezone; use one like "Asia/Jerusalem" or "UTC"`,
    );
  }
  return zone;
}

/** This host's zone, used by `cod init` so a new workspace is right by default. */
export function hostTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
}

/**
 * A human rendering of a zone's current offset, e.g. "+03:00".
 *
 * Shown alongside every cron expression, because "0 2 * * *" means something
 * completely different at +00:00 than at +03:00 and the reader cannot tell
 * which one applies without being told.
 */
export function offsetFor(zone: string, at: Date = new Date()): string {
  if (!isValidTimezone(zone)) return "unknown";
  // Read the wall clock in the target zone, then subtract it from UTC. The
  // sign is inverted because getTimezoneOffset counts minutes BEHIND UTC.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const minutes = Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** `Asia/Jerusalem (+03:00)` - the form shown to a human. */
export function describeTimezone(zone: string, at: Date = new Date()): string {
  return `${zone} (${offsetFor(zone, at)})`;
}

/** The `TZ=` environment variables the container and its execs both need. */
export function timezoneEnv(zone: string): Record<string, string> {
  return { TZ: requireTimezone(zone) };
}
