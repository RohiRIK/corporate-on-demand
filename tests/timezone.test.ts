/**
 * Timezone.
 *
 * The bug being pinned: Docker defaults a container to UTC, `Bun.cron` fires on
 * local time, and nothing set a zone - so every schedule fired at the wrong hour
 * and reported success. The tests that matter are the ones that fail against the
 * old behaviour.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TIMEZONE,
  describeTimezone,
  hostTimezone,
  isValidTimezone,
  offsetFor,
  requireTimezone,
  timezoneEnv,
} from "../src/timezone";
import { UsageError } from "../src/errors";
import { buildRunArgv, type ContainerSpec } from "../src/docker";

const spec = (over: Partial<ContainerSpec> = {}): ContainerSpec => ({
  name: "cod-sandbox-x",
  user: "1000:1000",
  image: "cod-sandbox:1.3.12",
  network: "bridge",
  memory: "2g",
  cpus: "2",
  labels: {},
  mounts: [],
  env: {},
  ...over,
});

describe("validation", () => {
  test("accepts real IANA zones and the default", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Asia/Jerusalem")).toBe(true);
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(DEFAULT_TIMEZONE).toBe("UTC");
  });

  test("rejects nonsense rather than silently falling back to UTC", () => {
    // This is the whole bug: an unrecognised zone behaving as UTC is how the
    // schedule got quietly wrong in the first place.
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("Jerusalem")).toBe(false);
    expect(isValidTimezone("Asia/Nowhere")).toBe(false);
    expect(() => requireTimezone("Asia/Nowhere")).toThrow(UsageError);
  });

  test("the error names the bad value, so it can be fixed", () => {
    expect(() => requireTimezone("Middle-Earth")).toThrow(/Middle-Earth/);
    expect(requireTimezone("Asia/Jerusalem")).toBe("Asia/Jerusalem");
  });
});

describe("offsets", () => {
  test("UTC is +00:00", () => {
    expect(offsetFor("UTC")).toBe("+00:00");
  });

  test("Jerusalem is +03:00 in September, which is the shift that was lost", () => {
    // 2026-09-29 is IDT (UTC+3). The container was reporting +00:00, so a job
    // set for 02:00 fired at 05:00 local.
    const september = new Date("2026-09-29T12:00:00Z");
    expect(offsetFor("Asia/Jerusalem", september)).toBe("+03:00");
  });

  test("Jerusalem is +02:00 in January, so the offset is not hardcoded", () => {
    const january = new Date("2026-01-15T12:00:00Z");
    expect(offsetFor("Asia/Jerusalem", january)).toBe("+02:00");
  });

  test("an invalid zone reports unknown rather than a wrong offset", () => {
    expect(offsetFor("Asia/Nowhere")).toBe("unknown");
  });

  test("describeTimezone pairs the zone with its offset", () => {
    const described = describeTimezone("Asia/Jerusalem", new Date("2026-09-29T12:00:00Z"));
    expect(described).toContain("Asia/Jerusalem");
    expect(described).toContain("+03:00");
  });
});

describe("the container gets the zone", () => {
  test("TZ reaches the container argv, or cron is still on UTC", () => {
    // THE regression test. Without this the container is UTC and every schedule
    // is hours off.
    const argv = buildRunArgv(spec({ env: timezoneEnv("Asia/Jerusalem") }));
    expect(argv.join(" ")).toContain("TZ=Asia/Jerusalem");
    expect(argv).toContain("-e");
  });

  test("no zone configured means no TZ, which is the documented default", () => {
    expect(buildRunArgv(spec()).join(" ")).not.toContain("TZ=");
  });

  test("an invalid zone never reaches an argv", () => {
    expect(() => timezoneEnv("Asia/Nowhere")).toThrow(UsageError);
  });
});

describe("hostTimezone", () => {
  test("returns something Intl recognises", () => {
    expect(isValidTimezone(hostTimezone())).toBe(true);
  });

  test("falls back to UTC rather than an empty string", () => {
    // An empty zone would produce a malformed `TZ=` and a container that
    // guesses. UTC is at least honest.
    expect(hostTimezone()).not.toBe("");
  });
});
