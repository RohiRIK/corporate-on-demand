# External Penetration Testing via OpenCode

## When to Use
- After architecture pivots (deployment target changed)
- When internal Security department audits have gone stale
- For fresh-eyes review not anchored to the existing checklist
- Periodic (monthly/quarterly) independent security review

## Approach

Use OpenCode CLI with a free/cheap model (e.g. `opencode/deepseek-v4-flash-free`) to run security review as an external agent — independent of the internal Security department's cron cycle.

### Static Site PT Scope
For GitHub Pages / static sites, the PT should cover:
1. **Client-side JS patterns** — `eval()`, `innerHTML`, `document.write`, `new Function`, `setTimeout` with string args
2. **DOM-based XSS** — URL parameter handling, `location.hash`/`location.search` usage, `postMessage` listeners
3. **CSP headers** — what GitHub Pages actually serves (not what nginx.conf said)
4. **Supply chain** — integrity of vendored libs (LittleJS, zzfx, etc.), CDN references, SRI hashes
5. **Information leakage** — API keys, internal URLs, debug flags, source maps in production
6. **localStorage/sessionStorage** — sensitive data exposure, XSS via stored values
7. **Game-specific** — input injection via game controls, canvas data exfiltration, WebSocket/fetch calls

### Running the PT

```bash
# One-shot review of all JS files
~/.opencode/bin/opencode run \
  'You are a penetration tester. Review all JavaScript files in frontend/public/js/ for security vulnerabilities. Focus on: XSS (DOM-based, reflected, stored), unsafe eval/innerHTML, information leakage, supply chain risks, localStorage abuse. Report findings with severity (Critical/High/Medium/Low/Info), file:line, and proof-of-concept. If no vulnerabilities found, explain what you verified.' \
  --model opencode/deepseek-v4-flash-free

# Review specific game file
~/.opencode/bin/opencode run \
  'Penetration test this game file for security issues. Check for: eval, innerHTML, external fetches, postMessage, URL parameter injection, localStorage of sensitive data.' \
  -f frontend/public/js/games/breakout-prism-shatter.js \
  --model opencode/deepseek-v4-flash-free
```

### Parallel Multi-Model PT
Run multiple models for higher confidence — findings that appear in multiple reviews are higher severity:

```bash
# Model 1
~/.opencode/bin/opencode run 'PT prompt...' --model opencode/deepseek-v4-flash-free &
# Model 2 (if available)
~/.opencode/bin/opencode run 'PT prompt...' --model opencode/nemotron-3-super-free &
wait
```

## Integration with Corporate Pipeline

1. Run PT externally (not through Security department cron)
2. Collect findings into a report
3. File findings as `departments/security/advisories/<date>-external-pt.md`
4. Send inbox to Security with findings to verify/triage
5. Send inbox to R&D for any code fixes needed
6. CEO/Board should be notified of Critical/High findings

## Weekly Automated PT (Cron Setup)

Set up a recurring cron job for weekly PT scans:

```bash
# Create a Hermes cron job — runs every Sunday at 03:00
# Uses OpenCode + DeepSeek to scan the full codebase
# Report saved to departments/security/pt-reports/YYYY-MM-DD-weekly-pt.md
# Summary delivered to CEO via Telegram
```

**Report distribution:** All technical departments (CTO, R&D, DevOps, Security) must review findings in their next cycle. Create a confluence decision documenting the PT process and send inbox messages to all affected departments.

**Report location:** `departments/security/pt-reports/` — separate from internal Security audits in `departments/security/audits/`.

## Security Department as Triage Owner

The PT report alone isn't enough — Security must own the triage-to-remediation pipeline:

### After Every PT Report:
1. **Break down findings into tasks** — one inbox message per CRITICAL/HIGH/MEDIUM finding to the owning department, with file, line, PoC, and remediation steps copied from the report
2. **Route correctly** — code fixes → R&D, headers/deployment → DevOps, architecture → CTO
3. **Set deadlines** — CRITICAL = next cycle, HIGH = within 2 cycles, MEDIUM = within 1 week
4. **Track remediation** — create `departments/security/pt-tracking/YYYY-MM-DD.md` with finding status table
5. **Verify fixes** — when a department reports a fix, Security re-runs the specific check. Don't take their word for it. Mark RESOLVED only after verification.
6. **Escalate** — if CRITICAL/HIGH not addressed within deadline, escalate to CTO and CEO

Without this process, PT reports become shelf-ware — findings sit in a file nobody reads. The generic "review the PT report" inbox message is not enough; departments need specific tasks with specific files and specific deadlines.

### Inbox Message Template for Findings

```markdown
# PT Finding: [Title] — [SEVERITY]

**From:** Security (PT Triage)
**Deadline:** [date based on severity]
**PT Report:** departments/security/pt-reports/YYYY-MM-DD-weekly-pt.md

## Vulnerability
[Description from PT report]

## Location
[File:line from PT report]

## Proof of Concept
[PoC from PT report]

## Required Fix
[Remediation from PT report]
```

## Pitfalls
- Free models can disappear — check `opencode models` before running
- PT findings need human verification — LLMs hallucinate vulnerabilities
- Don't let the PT agent modify code — review-only mode
- Static site PT is different from dynamic app PT — no server-side injection, no auth bypass, no SSRF
