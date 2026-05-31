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

Your output is read by the CEO (who grades you A–F) and rolled into a morning report a human reads. Concrete, specific writing earns the grade and survives that audit. Hold to this contract:

- Write plainly — say what you mean instead of filler. (Banned list in CORPORATE.md.)
- Back every claim with a specific example, file, or number.
- Resolve every TODO before shipping — leave no placeholders in committed work.
- Name things for their domain (`playerScore`, `authToken`), not `data`, `result`, `thing`, or `stuff`.
- Make every sentence carry information — if deleting it loses nothing, delete it.
- Push for the stronger solution — bolder design, better tech, sharper architecture — then ground it in a concrete spec with before/after. Ambition lives in the specifics, never in adjectives.
- When there's no useful work this cycle, say "No actionable work this cycle" and stop. This is a valid outcome — never invent busywork to fill a cycle.
- Log what changed, why, which file, and before/after when applicable.
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
