# Mandatory Pipelines

Every department follows a strict pipeline. Steps **cannot be skipped**. Each step is typically one cron run — this forces thoroughness over speed.

## R&D Pipeline: `research → pitch → spec → build`

| Step | Output Dir | What It Produces | Gate |
|------|-----------|-------------------|------|
| research | research/ | Analysis doc with findings, prior art, constraints | Must exist before pitching |
| pitch | pitches/ | Proposal with rationale, scope, effort estimate | Must reference a research doc |
| spec | specs/ | Implementation spec with pseudocode, file changes, test plan | Must reference a pitch |
| build | (codebase) | Working code committed to repo | Must reference a spec |

**Enforcement**: If the agent's prompt detects no spec exists for the current task, it MUST write the spec. It MUST NOT build. The prompt must say: *"If no spec exists for your current directive, write the spec. Do NOT build yet."*

## UX/UI Pipeline: `research → design → build`

| Step | Output Dir | What It Produces | Gate |
|------|-----------|-------------------|------|
| research | research/ | UX problem analysis, user flows, reference screenshots | Must exist before designing |
| design | designs/ | Mockup description, exact CSS changes, interaction notes, before/after | Must reference research |
| build | (codebase) | Implemented design changes | Must reference a design doc |

**Enforcement**: Design docs must include current state, proposed state, and exact CSS/HTML changes. No "make it look better" — every change must be specified.

## Infra Pipeline: `audit → runbook → execute`

| Step | Output Dir | What It Produces | Gate |
|------|-----------|-------------------|------|
| audit | audits/ | Health measurements, metrics, identified issues | Always runs first |
| runbook | runbooks/ | Step-by-step procedure with rollback plan | Required for new procedures |
| execute | (infrastructure) | Applied changes per runbook | Must follow a runbook |

**Enforcement**: No infrastructure changes without measurement first. Every new procedure gets a runbook with explicit rollback steps. Existing runbooks can be executed directly.

## PM Pipeline: `review → changelog/standards/report`

| Step | Output Dir | What It Produces | Gate |
|------|-----------|-------------------|------|
| review | (reads logs/) | Reads all recent department logs | Always first |
| output | changelogs/ OR standards/ OR reports/ | Compiled changelog, updated standards, or status report | Must be based on actual log data |

**Enforcement**: PM never invents information. Everything in changelogs and reports must trace back to a log entry or artifact.

## Board Pipeline: `synthesize → coordinate → document`

| Step | Output Dir | What It Produces | Gate |
|------|-----------|-------------------|------|
| synthesize | (reads state.json + all depts) | Cross-department situation awareness | Always first |
| coordinate | (inbox files) | Delegation tasks, priority adjustments | Based on synthesis |
| document | minutes/ | Board meeting minutes with decisions and action items | Every run |

## Pipeline Enforcement Rules

1. **No skipping**: An agent that tries to jump ahead gets corrected by CEO at next inspection
2. **One major step per run**: Prevents rushed, low-quality output
3. **Artifacts persist**: Research, pitches, specs, designs accumulate across runs — they are the department's institutional memory
4. **Cross-references required**: Each artifact must reference its prerequisite (spec links to pitch, pitch links to research)
5. **CEO can fast-track**: In emergencies, CEO can write a directive allowing a department to skip a step — but must document why
