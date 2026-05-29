# Schedule Optimization — QA Buffer Rule

## Problem
If QA runs too close after R&D/UX (e.g., 5 minutes), R&D may still be mid-cycle when QA starts testing. QA tests stale code and misses real regressions — or worse, tests half-applied changes and files false bugs.

## Rule
QA must have a **minimum 20-minute buffer** after both R&D and UX/UI complete.

## Recommended Layout (2-hour cycle)

```
:00  Board / DevOps / Security(6h)
:10  UX/UI
:20  R&D
:40  QA           ← 20 min after R&D, 30 min after UX
:45  IT
:50  PM
:55  Infra
```

## Why This Order
1. **Board** sets directives first (:00)
2. **UX/UI** and **R&D** execute changes (:10, :20)
3. **QA** verifies after both have finished (:40) — enough buffer for builds/deploys
4. **IT/PM/Infra** do housekeeping after everything lands (:45-:55)

## Anti-Pattern
```
:15  UX/UI
:25  R&D
:30  QA     ← only 5 min buffer — BAD
```

## Applying Schedule Changes
```bash
hermes cron update <job_id> --schedule "40 1-23/2 * * *"
```

Even/odd hour staggering (`*/2` vs `1-23/2`) is preserved per department to avoid collisions.
