# Security review — status of each finding

The findings in this directory are kept as they were written: they are the record
of what was wrong and why. This file is the index of what became of each one.
Updated 2026-10-02, with the pass planned in
`.hermes/plans/2026-10-02_060000-close-the-open-findings.md`.

"Closed" means fixed in code, pinned by a test that fails when the fix is
removed (each was mutation-checked), and - where it is a container property -
re-checked on a live container by `scripts/cleanroom.sh` or the dogfood run.

| Finding | Severity | Status | Where it was closed |
|---|---|---|---|
| SEC-01 — command injection in the agent launcher | HIGH | **Closed** | No shell on the agent path: the prompt is one raw argv element (`src/backend.ts`, `src/agent.ts`). `tests/shellinject.test.ts`. |
| SEC-02 — the reviewer's own words re-executed by a shell | SEVERE | **Closed** | Same fix as SEC-01: there is no shell for model text to reach. `tests/shellinject.test.ts`. |
| SEC-02 — `.gitattributes` filter drivers turn a merge into code execution | HIGH | **Closed** | Every supervisor git command runs with no global or system config, hooks and fsmonitor off (`src/git.ts`); every diff with `--no-ext-diff --no-textconv` and no attributes file; `.gitattributes` and `.gitmodules` are global paths wherever they sit (`src/boundary.ts`); and agents cannot write `.git/config` at all (the sandbox). `tests/diffguard.test.ts` configures REAL textconv and external drivers and proves an unguarded diff runs them. `tests/globalpaths.test.ts`, `tests/sandbox.test.ts`. |
| SEC-03 — the worktree is not a boundary; agents reach the shared state | HIGH | **Closed, with stated limits** | Every agent runs inside Landlock (`docker/sandbox.c`, `src/sandbox.ts`): no access to `/cod` (ledger, results, logs, `cod.json`), no writes to the main checkout, `.git/config`, `.git/hooks`, `.git/info` or refs outside `refs/heads/cod/`, only its own worktree; on ABI 6+ no signals to the supervisor. Fails closed. `tests/sandbox.test.ts` (the real launcher, real git); the clean room; the dogfood's hostile worker, denied every one. **Not closed:** read access to the repository and other worktrees, shared `/tmp` and `$HOME`, any `cod/` ref is writable, egress is open - see `docs/SECURITY_POSTURE.md`. |
| SEC-03 — git as an execution vector during the merge | SEVERE | **Closed** | The guard covers every git call, not one (`src/git.ts`); the base branch is read through the common git dir and a job worktree's HEAD is never trusted (`resolveBase`); conflicts are found with `git merge-tree` before merging and a failed merge is aborted; symlinks, submodules and binaries are refused mechanically (`src/land.ts`). `tests/reviewloop.test.ts`, `tests/basebranch.test.ts`, `tests/diffguard.test.ts`. |
| SEC-04 A — the Docker-socket guard is an exact-string blocklist | SHOULD-FIX | **Closed** | `assertMountAllowed` resolves the path and follows symlinks, then refuses `/`, any socket, a runtime's own directory, any runtime socket by name, a directory holding one where runtimes put them, and a relative source (`src/docker.ts`). `tests/operator.test.ts`, with real sockets and symlinks. |
| SEC-04 B — the writable landing mount | SEVERE | **Closed** | Nothing on the host is mounted writable except the state directory, which agents cannot reach. Landed work leaves as a git bundle; `cod land` fetches it on the host, fast-forward only, after `git fsck --strict` in a throwaway repository (`src/export.ts`). `tests/export.test.ts`, `tests/landing.test.ts`. |
| SEC-04 — sandbox claims: "credential-free" with a writable landing repo | MEDIUM | **Closed** | By SEC-04 B: there is no landing mount. |
| SEC-04 — sandbox claims: uid 1000 is the operator's own uid | INFO | **Partly closed** | Agents can no longer write the state directory at all, so an agent-written ledger row is no longer possible. The `/work` volume is still written by the same uid as everything else in the container. |
| SEC-04 — sandbox claims: the default bridge network | INFO | **Accepted** | Egress is open by design; see `docs/SECURITY_POSTURE.md`. |
| SEC-05 — `targetPaths` and the payload are never validated | SHOULD-FIX | **Closed** | Target paths are validated as repository paths, from/to as names, kinds as words; payloads and reasons are capped and redacted (`src/work.ts`). `tests/ledgerintegrity.test.ts`. |
| SEC-05 — two id rules for one value; the dead containment check | MEDIUM | **Closed** | The work id follows the worktree's rule (lowercase, leading alphanumeric, no `..`); `writeWorkFile`'s containment is a real prefix test on the resolved path (`src/work.ts`). `tests/ledgerintegrity.test.ts`. |
| SEC-06 — the CI secret scan is a three-pattern grep | MEDIUM | **Closed in code; the workflow half awaits a push** | `scripts/secret-scan.sh` scans for `src/redact.ts`'s credential shapes - seven, not three - on the tree or on every line a range of commits adds; `verify.sh` runs it, so CI's verify job does. `tests/secretscan.test.ts` holds one sample of each family. The per-push range scan in `.github/workflows/ci.yml` could not be pushed by a token without the `workflow` scope: it is `ci-range-scan.patch` in this directory, ready to `git apply`. The history was scanned once by hand with the full list: one visibly fake `sk-live-…` test fixture in an old plan document, already scrubbed; no credential. (Not quoted here: this file is scanned too.) |
| SEC-06 — the ledger is not redacted; the reviewer gets the prompt verbatim | SHOULD-FIX | **Closed** | Payloads and reasons are redacted on the way into the ledger, and in-flight markers too; the reviewer is sent a redacted task and diff (`src/work.ts`, `src/inflight.ts`, `src/review.ts`). `tests/ledgerintegrity.test.ts`, `tests/reviewloop.test.ts`, `tests/operator.test.ts`. |
| SEC-07 — the state volume is the carrier | LOW | **Closed** | Agents cannot write it (SEC-03), its free text is redacted (SEC-06), and a state directory cod creates is `0750`, as the systemd unit's is - the ledger, results and log are no longer world-readable on a shared host (`makeContainerDir`, `src/config.ts`). `tests/stateowner.test.ts`. |

## What is not a finding but is worth knowing

- The live model call and the stock image build were not exercised in the session
  that closed these: its egress policy blocked the model providers and the apt
  mirrors. The image was built from the same Dockerfile on the same Debian
  release with only the apt layer replaced, and the agent path was run end to end
  with stub engines that speak the engines' JSONL contract. See `CHANGELOG.md`.
