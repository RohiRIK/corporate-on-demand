# What must hold for a run to count as successful

## The assertion contract

A run passes only when **all** of these hold. None is optional, and none is
substitutable by the exit code.

| Rule | What it catches |
|---|---|
| A terminal completion event (`reason: "stop"`) | the stream was truncated mid-flight |
| At least one tool that **completed** | the agent claimed work it did not do |
| No error events, even alongside a clean finish | a run that failed and finished anyway |
| A prompt longer than the minimum | the agent was never actually given a task |
| Elapsed under the budget | a slow "success" that did not do anything |

## Order is a decision

Check the prompt **first**, before the stream, even though it is cheapest: a
call that was never properly given a task cannot be rescued by a well-formed
answer to the wrong question.

Check the exit code **last**. It is the weakest signal available, so every
stronger signal deserves to speak first.

## Completed means completed

A tool reporting `status: "completed"` whose command exited non-zero is **not**
completed. This is the only place that difference is visible, and believing the
status field is how a failed build looks like a passing one.

## One relaxation, opt-in, per job

Some jobs legitimately complete no tool: they read and report. Allow that with
an explicit per-job flag that **defaults to strict**.

A global relaxation is how the wrong-reason class returns, because then every
job may claim work it did not do. Even the opt-out must still require a clean
finish, no errors, and a real prompt. It is a narrower pass, not a bypass.

## The fixture trap

A shared happy-path stream fixture must itself encode a **valid successful
run**, including the completed tool. When the assertion gets stricter, a fixture
that was never realistic stops being a passing example and quietly becomes a
passing lie. When that happens, fix the fixture, not the rule.

## Mutation verification

For each rule: delete it, run the suite, confirm failures. Record the count. A
rule that breaks nothing when removed is a comment wearing a rule's clothes, and
the most likely candidates are the ones added last in a hurry.

## Consume the verdict

The judgement is worthless until the layer that **records** the result reads it.
If the judge returns a failure and the recorder writes `ok: true` anyway, the
judge has bought nothing.

Make one exported predicate the only thing permitted to interpret the verdict,
and test it with both a real failure and a real answer. Also test a legitimate
answer that merely *begins* with the failure marker: a naive prefix check will
misread it, and that false positive is its own bug.

## Diagnose, do not just report

An opaque failure message is a bug with a small fix. Most agent CLIs emit a
correlation id in their error events and write the same id into a structured
log. That id is a join key: resolve it and the failure line carries a real
cause.

Bounded: one line, never throws, and it says so plainly when it finds nothing.
Silence is the bug being replaced. Note that a fork may write its logs to a
**different** directory than the project it forked from, so search every known
location rather than the one you expect.
