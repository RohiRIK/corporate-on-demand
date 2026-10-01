# SEC-01 — Command injection in the agent launcher (HIGH)

## Where

- `src/agent.ts:71` — `Bun.spawn(["sh", "-lc", args.join(" ")], ...)`
- `src/backend.ts:136-150` — `buildFor()` builds argv and ends with `JSON.stringify(prompt)`

## What

The git path (`src/land.ts:61-71`) genuinely uses `execFileSync("git", [...args])` with an
argv array — no shell there, confirmed. The agent path does not.

`localRunner` joins the argv array into ONE string and hands it to `sh -lc`. The comment at
`src/agent.ts:64-65` states the intent: "The prompt is JSON-quoted so a task containing
quotes or newlines cannot break out of the command." That holds for quotes and newlines.
It does not hold for shell expansion.

`JSON.stringify` escapes `"`, `\`, and control characters. It does **not** escape `$`,
backtick, or `!`. The emitted prompt is a double-quoted shell word, and inside a
double-quoted word `sh` still performs command substitution:

- `$(cmd)` → executed
- `` `cmd` `` → executed
- `${IFS}` / `$VAR` → expanded

So any `$` or backtick in the prompt is live shell syntax, not a literal.

## Impact

Arbitrary command execution as UID 1000 inside the sandbox container, at prompt-construction
time — before the model is even consulted. The execution is not limited to what the model
chooses to run; it happens regardless of model behaviour, on every run whose prompt contains
those characters.

`buildPrompt` (`src/agent.ts:124-139`) composes the prompt from `cron.task` and
`company.purpose`. `cron.task` is a workspace `cod.json` field. The `.gitattributes`,
`.gitmodules`, config-file and repo-file angle is therefore the real question — whether any
path lets non-operator-authored text reach `cron.task` or `company.purpose`. That chain was
NOT fully traced in this pass (see open question below). Independent of who authors it,
this is a latent injection primitive sitting in the process-launch path of a system whose
entire security argument is "untrusted input, contained".

Secondary, smaller: `--title` (`src/backend.ts:148`) is interpolated into the same joined
string **unquoted at all**. `title` comes from `cod-${cron.name}`. Any `$`/space/metachar
in a cron name is parsed by the shell. No quoting whatsoever, unlike the prompt.

## Fix

Do not join. Pass argv through:

```ts
Bun.spawn(args, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
```

`buildFor` already returns an argv array — the join is the entire bug. This also removes
the reason `sh -lc` was chosen (line 63-65 claims a single JSON-quoted word, which was a
workaround for the join, not a requirement of `opencode run`). If a shell is genuinely
required, use `shell-quote` per argument, not one whole-string join.

## Open question (not resolved this pass)

Trace whether `cron.task` / `company.purpose` / `cron.name` can be written by an agent or by
model output. `src/workspace.ts` and `src/work.ts` were not fully read. If they cannot, this
downgrades from "reachable" to "latent primitive + operator footgun"; the fix is the same
either way.