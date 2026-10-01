# SEC-06 — Credential paths: redaction is not applied to the ledger, and the reviewer prompt is handed to a model verbatim

**Severity: SHOULD-FIX (one item is SEVERE-adjacent)**
**Locations: `src/redact.ts:9-11` (sink claim), `src/work.ts:603-607` (`writeWorkFile`, no redaction), `src/work.ts:606` (`reason`), `src/supervisor.ts:156-164` (review prompt), `src/land.ts:135`**
**Class: CWE-532 insertion of sensitive information into log file / CWE-200 exposure of sensitive information**

## What is right

`redact.ts` is genuinely good work: eight anchored credential shapes, a `SECRET_NAMES` allowlist, a lookbehind fix for bare `API_KEY=`, and — importantly — an honest limit statement at `:13-16` saying it catches known shapes only and is "a mitigation, not a guarantee". The design decision to apply it *at the sink, once*, so a new call site cannot forget (`:9-11`), is the correct call.

## Finding A — the ledger is a sink, and it is not on the redaction list

`redact.ts:9-11` says "Applied at the sink, once, so a new call site cannot forget." That is a claim about *the* sink. `writeWorkFile` (`work.ts:216-234`) is a second sink — it writes a JSON file per work item under `<stateDir>/work/` — and it serialises the item with `JSON.stringify(item, null, 2)` at `:228` with **no redaction**.

What lands there verbatim:

- `payload` (`work.ts:605`) — the agent-authored task text, which routinely names the file being changed and can quote the code it is changing, including a key it just read.
- `reason` (`:606`) — **reviewer model output**, per `land.ts:156`.
- `output` (`runwork.ts:237` → `commit`) — the agent's own run output, which for an agent with `--auto` tools can contain anything it printed.

`/cod` is mounted **read-write** (`docker.ts:471`), so these files are inside the agent-reachable volume, and `supervisor.ts:233` logs to `LOG_DIR/cod.jsonl` via a sink that does redact — so the redaction exists, and this particular path bypasses it.

The exposure is bounded (the stated design goal is that agents are credential-free by construction, `backend.ts:30-32`), which is why this is SHOULD-FIX and not SEVERE. But the invariant "redaction is applied at the sink" is false as written, and `docs/SECURITY_POSTURE.md` should say so rather than inheriting the claim.

## Finding B — the diff and the task text go to a model provider unredacted

`land.ts:131` → `judgeReview` → `agent.ts:135` interpolates the **entire diff** into the prompt sent to the reviewer model:

```ts
answer = await input.ask(`${REVIEW_SKILL}\n\nTask: ${input.task}\n\nDiff:\n${input.diff}`);
```

`redact.ts` is not applied to `input.diff` or `input.task` on this path, and `ask` is `runAgent` → an external model endpoint (`supervisor.ts:156-164`).

The irony is exact: `review.ts:38-46` exists specifically to catch a secret in a diff and refuse it without asking a model — and then the diff, which may contain any secret the seven patterns do not match, is sent to the provider regardless. `redact.ts:13-16` already names the gap honestly ("a secret quoted in prose, a novel token format … is not caught"); the missing step is that nothing on this path redacts before egress.

Same for the agent path: `run-work-cli.ts:79` → `cron.task` → `buildPrompt` → `sh -lc` (SEC-01/SEC-02). Whatever the task text contains is both executed and transmitted.

## Concrete correction

1. Run `redact()` over `diff` and `task` in `judgeReview` (`review.ts:124-135`) before they reach `ask`, and over `payload`/`reason`/`output` in `writeWorkFile` (`work.ts:228`). That makes the "applied at the sink, once" claim true instead of aspirational.
2. Amend `redact.ts:9-11` and `docs/SECURITY_POSTURE.md` to name the sinks that exist, so the next person adding a sink knows the list is what they must join.
3. Note in the same doc that egress to a model provider is a credential path in its own right, independent of logs.

## Verification performed

Read-only. No model call was made, no file written, no network egress.