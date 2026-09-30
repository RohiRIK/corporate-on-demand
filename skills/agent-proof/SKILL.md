# Agent Proof

How to be sure a change to an agentic system did what you think it did. Every
rule here was learned by being wrong first; the ones that matter most are the
ones that look like they should not be necessary.

## Read

| Question | Read |
|---|---|
| What must hold for a run to count as successful? | `references/proof-rules.md` |
| Why does it keep looking fine when it is not? | `references/traps.md` |
| How do I actually check, end to end? | `references/verification-loop.md` |

## The three that get skipped

1. **Exit code 0 is not evidence.** Judge the event stream. A run that answered,
   exited 0, and completed no tool is a failed job wearing a successful record.
2. **The work passing is not evidence the work was directed.** An agent given no
   instructions will still do something plausible, because the model is capable.
   That is how a total prompt-delivery failure shipped and looked fine.
3. **Verify inside the environment that runs it.** The host and the image
   disagree constantly: paths, flags, permissions, available interpreters.

## Before you call it done

- Every new pass/fail rule is **mutation-tested**: delete it, confirm the suite
  fails. A rule no test can detect is a comment.
- The layer that **records** the verdict reads the verdict. A correct judgement
  nobody consumes is a lie with extra steps.
- At least one live run, from the container, with the real binary, and a probe
  the old code would fail.
