# SEC-07 — Credential handling: env is genuinely clean, redaction is real and tested, but the state volume is the carrier (LOW)

Requested: what env the container inherits, whether redaction is tested, whether the state
volume could carry secrets.

## Container environment — clean, verified

- `buildWorkspaceSpec` sets `env: { TZ: workspace.timezone }` and nothing else
  (`src/docker.ts:501`). No `-e` for credentials, no `--env-file`.
- `buildRunArgv` emits one `-e` per env entry (`docker.ts:312-314`). No secrets to leak
  because none are supplied.
- `entrypoint.sh:94-97` logs `no credentials are installed; this is intentional`, placed
  exactly where someone would be tempted to add one. That is a good tripwire.
- The credential-free claim is backed by a build-time assertion (`Dockerfile.sandbox:103`,
  `kilo --version` at build) and by a test that fails the build if a paid model id appears
  (`backend.ts:26-33`) — i.e. the $0 property is enforced, not just documented.

One inherited item worth naming: `Dockerfile.sandbox:132` sets
`git config --global --add safe.directory '*'`. Not a credential, but it is a
global-wildcard git setting, and it is one of the reasons a hostile repo can be read by an
agent. Low impact on its own; it is also *why* the SEC-02 filter chain is not blocked by
git's ownership checks.

## Redaction — real, applied at the sink, and tested

This is the strongest control in the codebase.

- Applied at the sink, once: `redactingSink` (`src/log.ts:117`) wraps the file sink
  (`src/log.ts:169`) so a new call site cannot forget to redact.
- Applied at the persistence sink too: `results.ts:93-95` redacts `task`, `output`, and
  `error`. The comment at `results.ts:82-83` records that an earlier version redacted only
  `output` and leaked a secret in the *task* text — a bug found and fixed, which is evidence
  the control is exercised rather than decorative.
- **Tested:** `tests/redact.test.ts` has 17 test cases.
- The module documents its own limit honestly (`redact.ts:13-16`): known shapes only; a secret
  in prose, a novel token format, or one split across two lines is not caught. It points at
  `docs/SECURITY_POSTURE.md` rather than implying the word "redaction" means "safe".
- Re-emits counts (`redact.ts:99`, `log.ts:130`) so a redaction that silently mangles a log is
  visible. Over-eager redaction treated as its own outage (`redact.ts:22-27`) is the right
  instinct — an unreadable log is an incident-response problem.
- The `lastIndex` reuse bug is explicitly guarded against (`redact.ts:86-88`) — a fresh
  `RegExp` per call, with the reason written down. Correct and correctly explained.

Gap: redaction covers *text going into logs and results*. It does not cover the **work
ledger** in the state volume, which stores `item.payload` and reviewer reasons verbatim
(`land.ts:151-156` reads and concatenates `work.reason`). If an agent writes a credential into
a task or a review reason, it lands in SQLite unredacted. Nothing in `work.ts` or
`land.ts` calls `redact`.

## The state volume as a secret carrier

`stateDir` → `/cod`, mounted **read-write** (`docker.ts:476`), backed by the host path
`~/.local/share/cod` (`config.ts:16`).

It carries:

- the SQLite ledger — `item.payload`, `reason`, reviewer text (unredacted, per above)
- the `bus/` directory (`config.ts:141`)
- log files written through `redactingSink` (redacted)
- results (redacted)

So: two of the four sinks are redacted, and the one holding the most free text — the work
payload, which is model-authored — is not. On a system where **the payload originates from an
AI agent that may quote a credential it read from a file**, that is the wrong one to leave
unfiltered. Combined with SEC-03 (the agent can write that DB), it is a two-sided problem: the
carrier is writable by the producer and unredacted.

This is LOW rather than HIGH because the container is genuinely credential-free (nothing
useful to steal from inside it), and the realistic exposure is a credential the agent copied
*in* from a file it was given, landing in a host-side SQLite file. Not zero, not remote.

## Fix

1. Run `redact()` over `payload` and `reason` on the way into the ledger in `work.ts`, matching
   what `results.ts:93-95` already does. One call site, existing tested function.
2. `stateDir` should be mounted `readOnly: true` — see SEC-03; that closes the write side of
   this finding at the same time.
3. Consider `core.fileMode`/umask on ledger writes so files are not world-readable under a
   shared UID. Not verified this pass.