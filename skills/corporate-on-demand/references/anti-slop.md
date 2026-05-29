# Anti-Slop Contract

## Banned Words & Phrases

These words signal filler, not information. Remove them and say what you actually mean:

**Verbs**: leverage, utilize, enhance, streamline, optimize, facilitate, empower, revolutionize, synergize, spearhead
**Adjectives**: robust, seamless, cutting-edge, state-of-the-art, world-class, best-in-class, innovative, comprehensive, holistic
**Filler phrases**: "various improvements", "multiple fixes", "general cleanup", "minor enhancements", "overall quality", "going forward", "in terms of", "at the end of the day"

## Anti-Slop Contract (embedded in every SYSTEM.md)

Every department SYSTEM.md must include this contract:

```markdown
## Anti-Slop Contract
- No filler words (see banned list in CORPORATE.md)
- No vague reports — every claim must have a specific example
- No placeholders — every TODO must be resolved before shipping
- No generic names: `data`, `result`, `thing`, `stuff` → use domain-specific names
- Every sentence must carry information — if it can be deleted without losing meaning, delete it
- If nothing useful to do, say "No actionable work this cycle" and stop
- Logs must include: what changed, why, what file, before/after if applicable
```

## CEO Quality Oversight

### Grading Scale
- **A**: Excellent — followed pipeline, produced useful artifacts, no slop
- **B**: Good — minor issues, mostly followed process
- **C**: Acceptable — some slop or a skipped nuance, but output is usable
- **D**: Poor — significant slop, skipped steps, or domain bleed
- **F**: Failing — output is harmful, wrong, or pure filler

### CEO Inspection Checklist
1. Read each department's latest artifacts
2. Check pipeline compliance (did they skip steps?)
3. Check for banned words/phrases
4. Check for domain bleed (did R&D touch CSS? did UX write game logic?)
5. Check inbox processing (are items going stale?)
6. Grade each department A-F in state.json
7. Write corrective directives to any department graded C or below
8. Make direct fixes when faster than delegating

### Quality Enforcement Loop
```
CEO inspects → grades → writes feedback → departments read feedback next run → improve → CEO re-inspects
```

Departments that consistently grade D or F get:
1. More specific directives (less autonomy)
2. Simplified scope (fewer responsibilities)
3. Prompt rewrites (if the SYSTEM.md isn't producing good output)
