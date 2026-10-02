# Close the open findings, make the loop iterate, verify end to end

**Date:** 2026-10-02 · **Repo:** `corporate-on-demand` · **Branch:** `claude/code-review-fix-issues-wwyin5`
**Authority:** owner request - go over the code, every open issue, plan and fix;
relevant features are welcome; report once at the end, after a deep check that
includes e2e and dogfooding; clean up what the tests produce.

## Where the open issues live

There are no open GitHub issues. The open work is recorded in the repository:
`.security-review/SEC-01..07`, the deferred items of
`.hermes/plans/2026-10-01_180000-merge-path-derives-from-git.md` (tasks 2-6 and
SEC-03), the "Known limitations" in CHANGELOG.md, and README's "Not yet done".
Reading the code against them found more, and every item below was reproduced
before it was planned, not inferred.

## Reproduced defects

| # | Defect | Evidence |
|---|---|---|
| 1 | `runWorkItem` claims by ADDRESSEE, not by id | ran item 2 of 2: item 1 was claimed and left `running`, item 2's result was fenced |
| 2 | a failed agent run on the ledger path is recorded `done`, `ok: true` | driver returned `agent FAILED: ...` -> state `done` |
| 3 | `commit()` accepts an item that was never claimed | `cod work commit <proposed-id> --epoch 0` -> `done`, CEO bypassed |
| 4 | a merge conflict leaves `/work` mid-merge | `UU notes.md`, `MERGE_HEAD` present; every later merge fails |
| 5 | `--override` is parsed and never forwarded | `cod work unblock <id> --override` refused, exit 0 |
| 6 | `cod init --yes` silently overwrites an existing cod.json | a customised purpose was replaced |
| 7 | landing pushes `/landing`'s own HEAD, not the merged work | `git -C /landing push origin HEAD:...` |
| 8 | the writable `/landing` mount lets an agent plant hooks/config the HOST user's git later runs | SEC-04 B |
| 9 | the department payload is joined with a literal `\n` | `.join("\\n")` in cycle.ts and meeting.ts |
| 10 | a department can only ever propose ONCE | its novelty key never changes, so the company does one round and idles |
| 11 | objections do not accumulate in production | the worker's commit overwrites `work.reason`, the only place they lived |
| 12 | an unreachable reviewer is a terminal rejection | provider blip -> blocked queue |
| 13 | landWork's "already reviewed" guard OVERWRITES the verdict it guards | a rejected item re-recorded as `skipped` is reviewed again |
| 14 | reviewer and meeting agents run with tool use inside `/work`, where merges happen | `workdir: WORK_REPO` |
| 15 | skills are never injected in the container | `skills/` is not in the image and SKILLS_DIR is relative to cwd |
| 16 | `cod supervise` starts a SECOND supervisor that outlives the exec | duplicate schedules and ticks |
| 17 | `cod up` fails on its own stopped container | name conflict after a crash loop or reboot |
| 18 | the test suite leaves ~120 directories (49 MB) in /tmp | measured |
| 19 | cleanroom.sh hardcodes the author's machine path, and its bind check is vacuous | `.Binds` is empty for `--mount` binds |
| 20 | the systemd unit creates a root-owned state dir uid 1000 cannot write | `mkdir` as root |
| 21 | an agent can read and write the ledger, master and other worktrees | SEC-03, the gate on unattended running |

Plus the review findings: SEC-02/03 (`--no-textconv`, attributes/submodules/
symlinks/binaries), SEC-04 A (socket guard by exact string), SEC-05 (target
paths, containment check, id validators, bounds), SEC-06/07 (ledger and reviewer
egress unredacted, CI scan narrower than the runtime patterns).

## Approach, by stage

1. **Ledger integrity.** `commit()` only from `running`; `claimById`; a global
   item refused at dispatch is `rejected` (it never ran); agent failure is
   `failed` with a bounded, redacted reason; run failures retried by the
   reconciler up to 3 times, then they wait for a person in `cod work blocked`.
2. **Review loop.** Objections live in the review row; `briefFor` reads them
   from there. Empty branch, merge conflict -> a mechanical request for changes
   inside the retry cap. Conflicts found with `merge-tree` before merging; a
   failed merge is aborted. Unreachable reviewer -> `skipped`, retried next tick.
   The guard stops overwriting verdicts. Derived radius on the merge path.
   Robust, fail-closed verdict parsing. Read-only roles run in a scratch dir.
3. **The loop iterates.** Departments propose a PLAN; the CEO decides and closes
   the proposal; the plan runs read-only and its GOAL/PATHS/CHECK answer becomes
   a concrete, path-scoped task; the task runs, is reviewed and lands; the
   department plans again only when it has nothing open, and stops proposing
   while three of its items wait on a person.
4. **Agent sandbox (SEC-03).** A static Landlock launcher compiled into the
   image. Agents get read-write on their own worktree, the git object store and
   their own `cod/` refs, `/tmp` and `$HOME`; read-only on the rest; nothing at
   all on `/cod`. Fail closed when Landlock is missing, unless the workspace
   says `agentSandbox: "off"`. Supervisor git runs with no global config and
   no hooks or fsmonitor.
5. **Landing without a host mount.** Landed work is bundled into the state dir;
   `cod land` fetches it into `landing.repo` on the host, fast-forward only.
6. **CLI and ops.** The CLI defects above, refusals exit 2, `--force` for init,
   `cod supervise` read-only, PID-1 guard, own stopped container replaced,
   state dir bound to one workspace, systemd ownership, atomic heartbeat,
   abandoned markers reported once, governance ticks never overlap.
7. **Mechanical review hardening, redaction, bounds, validation, CI scan.**
8. **Tests clean up after themselves** (a preload that owns TMPDIR), cleanroom
   fixed, docs brought back in line with the code.
9. **Verify:** typecheck, the full suite with Docker, mutation checks on every
   new guard, the clean room, and a dogfood run of the whole company in the real
   container with a stub engine (real model hosts are blocked by this
   environment's egress policy), including a hostile agent against the sandbox.

## Out of scope

Paid models, a GUI, more departments, semantic dedupe of reworded goals.
