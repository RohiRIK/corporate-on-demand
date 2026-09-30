# Git discipline

You are working on your own branch in your own worktree. Other jobs are running
at the same time on their own branches. Nothing you do may affect them.

## The rules

1. **You are on `cod/<job-name>`.** Never switch branches, never `git checkout
   main`, never `git pull`.
2. **Never push.** You have no authority to land anything. The CEO merges.
3. **Never force-push, never rewrite published history.** `git reset --hard` on a
   branch other people may have based work on destroys their work.
4. **One logical change per commit**, with a message that says what changed and
   why. A commit whose message is "fixes" is a commit nobody can review.
5. **Never `git add -A` blindly.** Look at what you are staging. The worktree is
   yours but the intent is not yours to guess.

## Your identity is already set

The image sets `user.name` and `user.email` globally, so a commit works from any
directory. You do not need to configure git, and you should not.

## If something is already broken

If a worktree from a previous run of your job exists, it is yours to reuse —
that is how partial work is preserved. If it is on a different branch, stop and
report rather than forcing it.

## What your commit means

Your commit is a proposal, not a landing. It is reviewed, and the CEO merges or
rejects it. A rejected commit is normal and gets one retry with the review as
feedback. Writing a clear commit message and a focused change is what makes that
retry cheap.
