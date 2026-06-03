# Prompt Optimization — DSPy + DeepEval + Promptfoo

> **TL;DR** — Three tools, three jobs, all LLM-agnostic and cron-callable. **DSPy** (Stanford, MPL-2.0) drives the iterative "revisit and re-improve" loop with GEPA optimizer. **DeepEval** (Apache 2.0) judges "is v2 actually better than v1?" with custom GEval metrics. **Promptfoo** (MIT) blocks regressions in CI/pre-publish. Maps onto the existing HR→CTO→CEO self-improving-prompts flow that was dormant in v3.8.0 waiting for the v2 DB. **This impl guide makes that flow ACTIVE today, no DB needed.**

---

## Why this exists

The `impl-self-improving-prompts.md` flow (v3.8.0) is dormant — it mines `project.db` for grades, directives, and prompt-versions. That DB doesn't exist yet (it's the v2 backbone in `spec-v2-db-migration.md`).

The Microsoft VSCode Chat Customizations extension (Waza) was the candidate analysis tool, but its LLM analysis is locked to GitHub Copilot — a single-vendor dependency that contradicts the self-improving loop's premise of independent review.

DSPy + DeepEval + Promptfoo solves both problems: LLM-agnostic, cron-callable, and purpose-built for the "build → analyze → compare → keep" loop.

## The three roles

| Job | Tool | What it does |
|---|---|---|
| **Iterate** (the "revisit") | **DSPy** with **GEPA** optimizer | Treats the prompt as a learnable program. GEPA uses an LLM to reflect on what worked, propose better instructions, iterate. |
| **Judge** (the "is it better?") | **DeepEval** with custom **GEval** metric | Runs v1 and v2 against a held-out test set, returns continuous scores, computes improvement. |
| **Block** (the "no regression") | **Promptfoo** | YAML-driven CLI runs promptfoo eval across multiple model + prompt configurations. Fails CI if a regression crosses threshold. |

Department mapping (matches `impl-self-improving-prompts.md`):

```
R&D  ─writes initial prompt────────────┐
                                       ▼
HR  ─detects recurring correction────→ [DSPy GEPA compiles improved prompt]
CTO ─drafts DSPy program, defines metric→ runs optimizer
QA  ─runs DeepEval on v1 vs v2────────→ v1_score, v2_score, improvement
CEO ─approves if v2_score > v1_score──→ writes new SYSTEM.md / workflow file
DevOps ─runs Promptfoo regression─────→ blocks deploy on regression
```

## Installation

DSPy and DeepEval are Python. Promptfoo is Node.js (already works with our Bun setup). Bridge Python from Bun via `Bun.spawn`.

```bash
# DSPy
pip install dspy-ai
# or with uv (faster, hermetic)
uv tool install dspy-ai
# or per-project
uv pip install --system dspy-ai

# DeepEval
pip install deepeval
# Configure judge model (use our OpenCode + DeepSeek, NOT the GPT-4o default)
deepeval set-ollama deepseek-r1:7b  # if using local Ollama
# OR set OPENAI_API_BASE to point at our internal LLM router

# Promptfoo
npm install -g promptfoo
# or
bun add -g promptfoo
```

Set the judge model in `~/.deepeval/.deepeval.conf`:
```toml
[model]
provider = "ollama"
model = "deepseek-r1:7b"
base_url = "http://localhost:11434"
```

This way DeepEval uses the same model we already use for `impl-external-pt.md` — independent of OpenAI/Copilot.

## Three scripts

### `prompt-optimize.ts` — DSPy wrapper

Drives the GEPA iterative loop. Bun subprocess that calls a Python program.

```bash
# Generate the Python DSPy program skeleton
$BUN $SCRIPTS/prompt-optimize.ts --path ~/myproj --action init \
  --task devops-dm-prompt \
  --examples data/devops-dm-examples.jsonl

# Run GEPA optimization
$BUN $SCRIPTS/prompt-optimize.ts --path ~/myproj --action run \
  --task devops-dm-prompt \
  --metric deepeval_geval \
  --budget 200
# → spawns `uv run --with dspy python programs/devops-dm-prompt/optimize.py`
# → writes optimized prompt to confluence/workflows/devops-dm-prompt.md
# → sends inbox to QA for verification
```

### `prompt-eval.ts` — DeepEval wrapper

Compares v1 and v2 prompts against a held-out test set.

```bash
$BUN $SCRIPTS/prompt-eval.ts --path ~/myproj \
  --v1 confluence/workflows/devops-dm-prompt.v1.md \
  --v2 confluence/workflows/devops-dm-prompt.v2.md \
  --test-set data/devops-dm-test.jsonl \
  --metric deepeval_geval \
  --threshold 0.05
# → spawns `uv run --with deepeval python eval_v1_v2.py`
# → prints: V1 score: 0.62, V2 score: 0.84, improvement: +0.22, RECOMMEND MERGE
# → returns exit 0 if v2 > v1 + threshold, exit 1 otherwise
```

### `prompt-regression.ts` — Promptfoo wrapper

Pre-publish + per-PR gate. Fails if any prompt regressed.

```bash
$BUN $SCRIPTS/prompt-regression.ts --path ~/myproj \
  --prompts references/ --baseline v3.9.0
# → spawns `promptfoo eval -c promptfooconfig.yaml --no-cache`
# → compares against baseline snapshot
# → exit 0 on pass, exit 1 on regression
# → on regression: sends P0 inbox to DevOps + writes incident report
```

## The HR-revisits-DevOps-DM walkthrough

Concrete example matching the corporate-on-demand cycle.

### Step 1 — HR detects the correction pattern
HR runs weekly and reads `outbox/devops/`. Notices: 3 of last 5 DevOps DMs sat unacknowledged for >2 cycles. Pattern: missing file:line, vague deadlines.

HR writes a `[PROMPT-CANDIDATE]` to CTO inbox:
```
[PROMPT-CANDIDATE] DevOps DM template is too vague.
Evidence: 3 of last 5 DMs unacked >2 cycles. Missing file:line + deadline.
Proposed: rewrite the DM template to require file:line, severity, deadline.
Priority: P1-HIGH
```

### Step 2 — CTO drafts the DSPy program
CTO reads `outbox/devops/` historical DMs, builds a training set:
```jsonl
{"dm": "API is down, fix it", "ack_within_1_cycle": false}
{"dm": "frontend/src/auth.js:42 — auth race, fix by 2026-06-04 14:00 UTC", "ack_within_1_cycle": true}
...
```
10–20 examples. CTO writes a DSPy program: `programs/devops-dm/optimize.py` that takes a `Situation` (free text) and produces a `DevOpsDM` with structured fields.

### Step 3 — DSPy GEPA runs the optimization
```bash
$BUN $SCRIPTS/prompt-optimize.ts --path ~/myproj --action run \
  --task devops-dm --metric deepeval_geval --budget 200
```
GEPA iterates: tries 5–10 prompt variants, judges each, keeps the best. Output: `confluence/workflows/devops-dm.v2.md`.

### Step 4 — QA verifies the improvement
```bash
$BUN $SCRIPTS/prompt-eval.ts --path ~/myproj \
  --v1 confluence/workflows/devops-dm.v1.md \
  --v2 confluence/workflows/devops-dm.v2.md \
  --test-set data/devops-dm-test.jsonl --threshold 0.05
```
Output: `V1: 0.62, V2: 0.84, improvement: +0.22, RECOMMEND MERGE`.

### Step 5 — CEO approves
CEO reads QA's report, sees v2 > v1 by 0.22 (>0.05 threshold), approves. Sends inbox to HR: "Promote devops-dm.v2 to canonical."

### Step 6 — HR writes the new workflow
HR moves `devops-dm.v2.md` to `devops-dm.md` (canonical). Updates SYSTEM.md reference. DevOps reads it next cycle, uses the better template.

### Step 7 — DevOps runs regression check (optional, pre-publish only)
```bash
$BUN $SCRIPTS/prompt-regression.ts --path ~/myproj --prompts confluence/workflows/ --baseline v3.9.0
```
If the live arcade platform has 17 clean QA cycles on the old DM, and the new DM hasn't been verified in production yet, the regression check fails — blocking the change. This is the safety net.

## What goes through DSPy vs what stays in SYSTEM.md

**DSPy is for task prompts** (the actual instructions sent to an LLM at runtime):
- DevOps DM template
- R&D pitch template
- QA verification checklist phrasing
- Any prompt that has measurable inputs/outputs

**SYSTEM.md identity lines stay verbatim** (no DSPy):
- "You are the CEO. You grade A-F."
- "You are R&D. You do research → pitch → spec → build."
- Identity is not optimizable — it's who you are, not how you do a task.

**Workflow docs in `confluence/workflows/` go through DSPy** when they contain prompts (e.g. "TDD workflow step 1: write a failing test that..."). If the workflow is pure process with no LLM-generated output, leave it as Markdown.

## Pitfalls (skill-specific)

- **Judge model bias.** If the judge and the prompt-being-tested use the same model, the judge rewards the model's own preferences. Use a different model for judging than for execution. We do this by default: judge = DeepSeek, executor = whatever the cron uses.
- **Training data leakage.** Never evaluate on training data. Always hold out 20% as test set. The scripts do this by default.
- **GEPA budget too low.** GEPA needs 50+ trials minimum. Budget <50 produces unreliable improvements. Default budget = 200.
- **DSPy wants structured I/O.** If the prompt is free-form ("write a creative game name"), wrap it in a signature with an output field. Don't feed raw strings.
- **DeepEval default judge is GPT-4o.** Override to our local model. Check `~/.deepeval/.deepeval.conf` before every run.
- **Promptfoo needs a config file.** Each project should have a `promptfooconfig.yaml` at the root. The `prompt-regression.ts` script will create one if missing.
- **DSPy programs accumulate.** Old programs in `programs/` should be archived (moved to `programs/_archive/`) after their prompt is merged. Otherwise the directory grows unboundedly.

## LLM-agnosticism — verification

This stack works with any LLM. The only requirement is that DSPy, DeepEval, and Promptfoo can each reach an OpenAI-compatible API. Tested configurations:

| Provider | DSPy | DeepEval | Promptfoo | Notes |
|---|---|---|---|---|
| OpenAI (any model) | ✅ | ✅ | ✅ | Default. Set `OPENAI_API_KEY`. |
| Anthropic Claude | ✅ | ✅ | ✅ | Set `ANTHROPIC_API_KEY`; DSPy uses LiteLLM, DeepEval uses LiteLLM. |
| Ollama (local) | ✅ | ✅ | ✅ | Set `OLLAMA_HOST`. Judge + executor same model = bias risk (see pitfalls). |
| OpenCode + DeepSeek | ✅ via LiteLLM | ✅ via custom base_url | ✅ via `openai:` provider with custom base_url | Our default for corp-on-demand projects. |
| Custom HTTP | ✅ via `dspy.LM` | ✅ via custom model class | ✅ via `provider` plugin | Universal fallback. |

## When NOT to use this

- **One-off prompt tweak.** If you're changing one word in a template, don't spin up DSPy. Just edit it. The cost of the optimization loop exceeds the value of the improvement.
- **Prompts with no measurable output.** "Be a good CEO" isn't optimizable. "Generate a grade rationale under 200 words citing 3 specific evidence points" is.
- **Prompts with no training data.** DSPy needs examples. If you have <5 examples, you don't have enough signal to optimize. Wait until you have more.
- **Pre-1.0 skills.** Don't add optimization complexity before the prompt is stable enough to have meaningful regressions.

## Related references

- `impl-self-improving-prompts.md` — the HR→CTO→CEO loop this guide activates
- `impl-hr-dept.md` § "Workflow Bridge" + "Prompt Signal" — HR's role
- `impl-qa-dept.md` § "Pre-publish regression" — QA's role
- `pre-publish-checklist.md` — adds the Promptfoo step
- `impl-external-pt.md` — uses the same OpenCode + DeepSeek setup for fresh-eyes review
- `spec-v2-db-migration.md` — the future DB that will let HR mine prompt-versions for longitudinal analysis
