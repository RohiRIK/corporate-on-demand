/**
 * Redaction.
 *
 * Job output is logged and persisted verbatim. Today the only output is an
 * echo of a task string, so the exposure is nil — but the moment agents do real
 * work, a log file is exactly where a credential that leaked into a command
 * line ends up living forever.
 *
 * Applied at the sink, once, so a new call site cannot forget. The alternative
 * is remembering to redact at every write, and one forgotten call site is a
 * secret on disk.
 *
 * **The honest limit:** this catches known shapes. A secret quoted in prose, a
 * novel token format, or a credential split across two lines is not caught.
 * This is a mitigation, not a guarantee, and is described that way in
 * docs/SECURITY_POSTURE.md rather than implied away by the word "redaction".
 */

/** The marker that replaces a secret. Fixed, not a hash. */
export const REDACTED = "[REDACTED]";

/**
 * Known credential shapes.
 *
 * Each anchored where it can be, so an ordinary word containing "token" is not
 * mangled. Over-eager redaction is its own outage: a log you cannot read is
 * not much better than no log.
 */
const PATTERNS: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: "openai-style key", re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: "github token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "github fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "aws access key id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "google api key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "bearer header", re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{12,}=*/gi },
  // A JSON web token: three base64url segments. Anchored on the dots so a
  // version string or a filename cannot match.
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
];

/**
 * Names whose `KEY=value` form is a secret.
 *
 * `auth` alone is deliberately NOT here. It matched "Authorization", so
 * `Authorization: Bearer <token>` came out as "Authorization=[REDACTED]" - the
 * header name destroyed and the token left behind. Bare `auth=` is rare enough
 * that mangling a correct log for it is the worse trade; `AUTH_TOKEN` and
 * `auth_token` still match, because the surrounding name is part of the
 * pattern.
 */
const SECRET_NAMES =
  "(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|credential|access[_-]?key|private[_-]?key)";

/**
 * `FOO_API_KEY=abc123`, `token: abc123`, `password="abc123"`.
 *
 * The `(?<![A-Za-z0-9_])` lookbehind is what makes a BARE name work. Without
 * it the pattern needs a prefix character, so `API_KEY=...` - the single most
 * common form there is - did not match, while `MY_APP_SECRET=...` did. That is
 * the worst possible direction for a bug: it passed the cases that look like
 * they have a prefix and missed the one that does not.
 */
const ASSIGNMENT = new RegExp(
  `(?<![A-Za-z0-9_])((?:[A-Za-z0-9_]*${SECRET_NAMES}[A-Za-z0-9_]*))\\s*[=:]\\s*("[^"\\n]*"|'[^'\\n]*'|[^\\s,;"']+)`,
  "gi",
);

export interface RedactionResult {
  readonly text: string;
  /** How many values were replaced, by category. */
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * Replace known credential shapes in `text`.
 *
 * Reports what it replaced. A redaction that silently changes your log is
 * indistinguishable from a bug, so the caller can surface the count.
 */
export function redact(text: string): RedactionResult {
  if (text === "") return { text, counts: {} };
  let out = text;
  const counts: Record<string, number> = {};

  for (const { name, re } of PATTERNS) {
    // A fresh lastIndex per call: these are module-level regexes with /g, and
    // a shared one would skip matches on the second invocation.
    out = out.replace(new RegExp(re.source, re.flags), (match) => {
      // `Bearer <token>` keeps the scheme, which is useful and not secret.
      const scheme = /^(Bearer|Basic)\s+/i.exec(match)?.[0];
      counts[name] = (counts[name] ?? 0) + 1;
      return scheme === undefined ? REDACTED : `${scheme}${REDACTED}`;
    });
  }

  out = out.replace(ASSIGNMENT, (_match, key: string, value: string) => {
    // An empty value is not a secret, and blanking it would be noise.
    if (value === '""' || value === "''" || value === "") return `${key}=${value}`;
    counts["assignment"] = (counts["assignment"] ?? 0) + 1;
    return `${key}=${REDACTED}`;
  });

  return { text: out, counts };
}

/** True when anything was redacted, for a cheap log-level decision. */
export function containsSecret(text: string): boolean {
  return redact(text).text !== text;
}
