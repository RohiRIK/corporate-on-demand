# Debugging

Find the cause. Do not guess-and-patch, and do not stop at the first thing that
makes the symptom go away.

## The order

1. **Reproduce it.** If you cannot reproduce it, say so and stop. A fix you
   cannot reproduce is a guess with a commit message.
2. **Read the actual error**, all of it. Not the summary, not your memory of it.
3. **Find where it comes from**, by reading code or running the command. The
   error's own words usually name the line if you let them.
4. **Explain the cause out loud** in one sentence before changing anything. If
   you cannot, you do not understand it yet.
5. **Make the smallest change** that addresses the cause.
6. **Run the thing that was broken.** Not the suite - the thing.

## The trap that costs the most time

A change that makes the error disappear is not a fix. It is a hypothesis. The
error disappears for at least four other reasons, and the most expensive one is
that you moved the failure somewhere quieter - a null check that hides a real
fault, a swallowed exception, a test you weakened.

If you find yourself adding an `if (!x) return;` to stop a crash, that is a
question, not a solution. Ask what `x` being null *means*.

## Report honestly

If you could not fix it, say what you ruled out and what you think the cause is.
An honest "I could not reproduce this, here is what I tried" is worth more to
the company than a confident patch that moves the failure.