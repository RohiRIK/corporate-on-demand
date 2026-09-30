/**
 * Redaction.
 *
 * Two halves, and the second matters as much as the first:
 *
 *  1. Known credential shapes never reach disk.
 *  2. Ordinary output is left completely alone. A redactor that mangles normal
 *     text is its own outage - a log you cannot read is not much better than
 *     no log - so the "untouched" tests here are not filler.
 */

import { describe, expect, test } from "bun:test";
import { REDACTED, containsSecret, redact } from "../src/redact";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, fileSink, memorySink, redactingSink } from "../src/log";

const secret = (out: string): string => {
  const result = redact(out);
  return result.text;
};

describe("known credential shapes", () => {
  test("an openai-style key is removed", () => {
    const out = secret("using sk-abcdefghijklmnopqrstuvwxyz012345 to call the api");
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(out).toContain(REDACTED);
  });

  test("github tokens, fine-grained and classic, are removed", () => {
    for (const token of ["ghp_abcdefghijklmnopqrstuvwxyz0123", "gho_abcdefghijklmnopqrstuvwxyz0123"]) {
      expect(secret(`token is ${token}`)).not.toContain(token);
    }
    const pat = "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz";
    expect(secret(`auth ${pat}`)).not.toContain(pat);
  });

  test("slack, aws and google keys are removed", () => {
    expect(secret("xoxb-123456789012-abcdefghijkl")).not.toContain("xoxb-123456789012-abcdefghijkl");
    expect(secret("AKIAIOSFODNN7EXAMPLE")).toBe(REDACTED);
    expect(secret("AIzaSyA1234567890abcdefghijklmnopqrstuv")).toBe(REDACTED);
  });

  test("a Bearer header keeps its scheme, which is useful and not secret", () => {
    const out = secret("Authorization: Bearer abcdefghijklmnopqrstuvwxyz");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz");
    // The scheme tells you WHICH auth failed. Losing it costs real debugging.
    expect(out).toContain("Bearer");
  });

  test("a JWT is removed", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(secret(`id_token: ${jwt}`)).not.toContain(jwt);
  });

  test("a KEY=value secret is removed, whatever the name", () => {
    for (const line of [
      "API_KEY=supersecretvalue123",
      "api_key: supersecretvalue123",
      "MY_APP_SECRET=supersecretvalue123",
      "PASSWORD=supersecretvalue123",
      "db_password: supersecretvalue123",
      "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123",
    ]) {
      expect(secret(line)).not.toContain("supersecretvalue123");
    }
  });

  test("redaction is reported, so a caller can surface the count", () => {
    const result = redact("API_KEY=supersecretvalue123 and AKIAIOSFODNN7EXAMPLE");
    expect(Object.keys(result.counts).length).toBeGreaterThan(0);
    expect(containsSecret("API_KEY=supersecretvalue123")).toBe(true);
  });
});

describe("ordinary output is untouched", () => {
  test("a normal build log survives verbatim", () => {
    const log = [
      "Compiling src/index.ts",
      "  12 modules bundled",
      "done in 42ms",
      "warning: unused variable `token`", // contains the word, not a secret
      "see https://example.com/docs/tokens for the API_KEY format",
    ].join("\n");
    // An over-eager redactor mangles perfectly good logs, which is its own
    // outage. This asserts the absence of damage, not the presence of a secret.
    expect(secret(log)).toBe(log);
  });

  test("words containing secret-ish substrings are not redacted", () => {
    for (const benign of [
      "tokenizer loaded",
      "passwords must be at least 12 characters",
      "the api-key-styles documentation is in references/",
      "SECURITY.md discusses the credential rules",
    ]) {
      expect(secret(benign)).toBe(benign);
    }
  });

  test("an empty value is not a secret and is left alone", () => {
    expect(secret('API_KEY=""')).toBe('API_KEY=""');
  });

  test("short strings that merely resemble a prefix are not touched", () => {
    // `sk-` alone is far too short to be a real key; redacting it would
    // corrupt ordinary text for no safety gain.
    expect(secret("sk- short")).toBe("sk- short");
  });

  test("empty input is handled", () => {
    expect(secret("")).toBe("");
    expect(containsSecret("")).toBe(false);
  });
});

describe("redaction is applied where it cannot be forgotten", () => {
  test("a log event carrying a secret never writes the secret", () => {
    // Through the REAL path - fileSink, which is what the container uses. A
    // test on memorySink alone would pass while the production path stayed
    // unredacted, which is precisely the "forgot at the call site" failure
    // this design exists to prevent.
    const dir = mkdtempSync(join(tmpdir(), "cod-redact-"));
    try {
      const path = join(dir, "cod.jsonl");
      const log = createLogger({ sink: fileSink(path), now: (): number => 0 });
      log.info("deploying with API_KEY=supersecretvalue123");
      const written = readFileSync(path, "utf8");
      expect(written).not.toContain("supersecretvalue123");
      expect(written).toContain(REDACTED);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a redaction is reported in the event, not applied silently", () => {
    const sink = memorySink();
    const log = createLogger({ sink: redactingSink(sink), now: (): number => 0 });
    log.info("deploying with API_KEY=supersecretvalue123");
    const event = sink.events[0];
    expect(event?.fields?.["redacted"]).toContain("assignment");
    // A secret is worth a warning: something unusual just happened.
    expect(event?.level).toBe("warn");
  });

  test("an ordinary event is passed through untouched and stays info", () => {
    const sink = memorySink();
    const log = createLogger({ sink: redactingSink(sink), now: (): number => 0 });
    log.info("Compiling src/index.ts, done in 42ms");
    const event = sink.events[0];
    expect(event?.msg).toBe("Compiling src/index.ts, done in 42ms");
    expect(event?.level).toBe("info");
    expect(event?.fields?.["redacted"]).toBeUndefined();
  });

  test("redacting twice is stable, so it can be layered safely", () => {
    // Idempotence matters: the sink and the writer may both redact, and a
    // second pass must not mangle the marker.
    const once = secret("API_KEY=supersecretvalue123");
    expect(secret(once)).toBe(once);
  });

  test("stateful regexes do not skip matches on the second call", () => {
    // A module-level /g regex keeps its lastIndex between calls, so the second
    // invocation can silently match nothing. Caught by calling twice.
    const input = "AKIAIOSFODNN7EXAMPLE";
    expect(secret(input)).toBe(REDACTED);
    expect(secret(input)).toBe(REDACTED);
  });
});
