# SEC-06 — CI secret scan is thin but not theatre; meaningful for its stated scope (MEDIUM)

## Verdict

**Meaningful for what it claims, materially weaker than "secret scan" implies.** It is a real
gate with real red-build behaviour, not a `|| true`. I would not call it theatre. I would call
it a three-pattern grep with a long exclusion list, and the name overpromises.

## What it actually does

`.github/workflows/ci.yml:66-75` — one `git grep` over tracked files for exactly three
shapes:

```
sk-[A-Za-z0-9_-]{16,}  |  gh[pousr]_[A-Za-z0-9]{20,}  |  AKIA[0-9A-Z]{16}
```

It fails the build on a hit, and it runs as its own job so a leak is visibly named
(`ci.yml:54-57`). That is a real control.

## Where it is weaker

**1. Three shapes vs. the runtime's eight.** `src/redact.ts:29-40` defines **eight**
credential patterns — google API key (`AIza...`), Slack (`xox[baprs]-`), bearer/basic headers,
JWTs, github fine-grained (`github_pat_`), plus the assignment-shape regex at `redact.ts:64-67`.
The CI scan covers **three** of them, and none of the two highest-yield categories: generic
`KEY=value` assignments and private keys.

`-----BEGIN ... PRIVATE KEY-----` is in the runtime reviewer (`src/review.ts:42`) and in
neither CI nor... actually it *is* in the runtime set. It is **absent from CI**. A committed
SSH or TLS private key is the single most likely real leak in a repo like this, and the one
shape CI would not flag.

**2. No high-entropy / generic-token detection.** Every pattern is a vendor prefix. Anything
without `sk-`, `ghp_`, or `AKIA` — a raw password, a bearer token, an npm/Azure/DO token, an
unlabelled credential — passes.

**3. `git grep` sees the index, not history — with `fetch-depth: 0`.** `fetch-depth: 0`
(`ci.yml:61`) fetches full history but `git grep` without a rev searches the **working tree**.
A secret committed and then removed from `master` is still in history and still reachable by
clone, and this scan will never see it. Given the system under review *merges untrusted agent
branches into master* (SEC-02), "it is not in master" is a weak assurance — the object is in
the object store and reachable from any ref that was pushed.

**4. The exclusion list is the load-bearing part.** Seven paths are excluded
(`ci.yml:69-72`), including four **test** files. The comment (`ci.yml:82-87`) argues the
fixtures are visibly elided (`sk-liv...`). That argument is reasonable *if true*, and it is not
machine-checked — the scan does not verify that the excluded regions contain elided fixtures
rather than a plausible token. An excluded test file is a hole with a comment explaining why
it is not a hole. That is the correct way to build one, but it is a hole.

**5. Untracked/ignored files are out of scope, correctly.** `git grep` searches tracked files
only. That is the right boundary for a CI gate, since `.gitignore` already excludes `.env`
etc. Not a finding; noted so the scope is explicit.

## Verdict, plainly

The scan catches the classic "I committed an API key" case for three vendors. It will not
catch a private key, a bare password, a bearer token, a Google key, or anything in history.
For a repo that merges AI-generated branches, history scanning (`gitleaks detect` /
`trufflehog git` over full history, or at minimum `git grep <re> $(git rev-list --all)`) is
the control that matches the actual threat model.

## Fix, smallest useful step

1. Reuse the existing patterns. `SECRET_PATTERNS` already exists in `src/review.ts:38-46` —
   seven patterns. The CI job should invoke that list rather than maintaining a divergent
   three-pattern copy. Two lists that disagree is how a shape ends up in one and not the other.
2. Add `-----BEGIN [A-Z ]*PRIVATE KEY-----` and the `AIza` pattern at minimum.
3. Scan history, or replace the job with `gitleaks detect --no-git` off full history. Given
   `fetch-depth: 0` is already paying for the full clone, the marginal cost is small.
4. If the seven exclusions stay, add an assertion that each excluded region still matches an
   elided-fixture shape — so a real token pasted into `tests/review.test.ts` fails the build
   for a reason the author can act on.