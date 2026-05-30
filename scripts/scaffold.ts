#!/usr/bin/env bun
// scaffold.ts -- Scaffold a new Corporate-on-Demand project
// Usage: bun scaffold.ts --name <project> --path <dir> --template <template>
// Templates: game, saas, content, devtools, homelab, data

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

// --- Department catalog: per-template definitions ---

type DeptDef = { focus: string; pipeline: string[]; subdirs: string[]; mustNotTouch: string };
type DeptCatalog = Record<string, Record<string, DeptDef>>;

const CSUITE_ROLES = ["ceo", "cto", "ciso", "cpo"];
const CORE_DEPTS = ["ceo", "cto", "ciso", "cpo", "rnd", "uxui", "infra", "pm", "board"];

const TEMPLATE_DEPTS: Record<string, string[]> = {
  game:     [...CORE_DEPTS, "devops", "qa", "it", "analytics"],
  saas:     [...CORE_DEPTS, "devops", "qa", "it", "security", "hr", "analytics"],
  content:  [...CORE_DEPTS, "it", "analytics", "editorial"],
  devtools: [...CORE_DEPTS, "devops", "qa", "it", "security", "analytics"],
  homelab:  [...CORE_DEPTS, "devops", "it", "security"],
  data:     [...CORE_DEPTS, "devops", "qa", "it", "security", "analytics"],
};

// Shared C-Suite definitions (same across all templates)
const CSUITE_DEFS: Record<string, DeptDef> = {
  ceo: { focus: "Quality oversight, grading all departments A-F, strategic direction", pipeline: ["inspect", "grade", "direct"], subdirs: ["directives", "reviews", "inbox"], mustNotTouch: "" },
  cto: { focus: "Technical oversight of R&D + Infra + IT, architecture decisions, tech debt tracking", pipeline: ["review", "direct", "audit"], subdirs: ["reviews", "directives", "audits", "inbox"], mustNotTouch: "Design files, content, business strategy" },
  ciso: { focus: "Security posture, vulnerability management, compliance, access control", pipeline: ["audit", "assess", "direct"], subdirs: ["audits", "assessments", "directives", "inbox"], mustNotTouch: "Feature code, design files, business logic" },
  cpo: { focus: "Product quality, UX consistency, design freshness, user experience advocacy", pipeline: ["review", "assess", "direct"], subdirs: ["reviews", "assessments", "directives", "inbox"], mustNotTouch: "Backend code, infrastructure, security configs" },
};

const DEPT_CATALOG: DeptCatalog = {
  // --- RND ---
  game:     { rnd: { focus: "Game design, mechanics, JS/Canvas game development", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox", "labs"], mustNotTouch: "CSS, design tokens, layout files, Docker configs" } },
  saas:     { rnd: { focus: "Feature development, API design, backend/frontend code", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox", "labs"], mustNotTouch: "CSS design tokens, infrastructure configs, deployment scripts" } },
  content:  { rnd: { focus: "Publishing tools, editor features, content APIs", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox", "labs"], mustNotTouch: "Content files, editorial decisions, design tokens" } },
  devtools: { rnd: { focus: "CLI/SDK development, API design, plugin architecture", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox", "labs"], mustNotTouch: "Documentation site, release pipeline configs" } },
  homelab:  { rnd: { focus: "Integration development, protocol bridges, automation rules", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox", "labs"], mustNotTouch: "Docker configs, dashboard UI, network configs" } },
  data:     { rnd: { focus: "ETL development, data transforms, pipeline logic", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox", "labs"], mustNotTouch: "Dashboard UI, orchestration configs, infrastructure" } },
};

// Helper to add dept definitions for a specific department across templates
function addDept(dept: string, defs: Record<string, DeptDef>) {
  for (const [tmpl, def] of Object.entries(defs)) {
    if (!DEPT_CATALOG[tmpl]) DEPT_CATALOG[tmpl] = {};
    DEPT_CATALOG[tmpl][dept] = def;
  }
}

// --- UXUI ---
addDept("uxui", {
  game:     { focus: "Game UI, CSS design system, player experience", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "Game logic, backend routes, Docker configs" },
  saas:     { focus: "Product design, user flows, responsive UI, accessibility", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "Backend logic, API routes, database schemas" },
  content:  { focus: "Reader experience, typography, content layout", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "Backend code, editorial content, infrastructure" },
  devtools: { focus: "Developer experience, documentation site, error messages", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "Core CLI/SDK code, release pipeline, package configs" },
  homelab:  { focus: "Dashboard design, mobile-friendly UI, status visualization", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "Integration code, Docker configs, IoT protocols" },
  data:     { focus: "Dashboards, data visualization, report templates", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "ETL code, pipeline logic, orchestration configs" },
});

// --- INFRA ---
addDept("infra", {
  game:     { focus: "Docker hosting, Nginx, health monitoring, deployment", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "Application code, game logic, CSS" },
  saas:     { focus: "Cloud infrastructure, CI/CD, monitoring, scaling", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "Application code, UI components, business logic" },
  content:  { focus: "CDN, media storage, performance, caching", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "Application code, content, design files" },
  devtools: { focus: "Release pipeline, package registry, CI/CD, versioning", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "Application code, documentation content" },
  homelab:  { focus: "Docker Swarm/Compose, IoT networking, monitoring, backups", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "Application code, dashboard UI, automation rules" },
  data:     { focus: "Pipeline orchestration, storage, scheduling", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "ETL logic, dashboard code, transform code" },
});

// --- PM ---
addDept("pm", {
  game:     { focus: "Game documentation, changelogs, submission standards", pipeline: ["review", "changelog"], subdirs: ["changelogs", "standards", "reports", "inbox"], mustNotTouch: "Application code, infrastructure, design files" },
  saas:     { focus: "Roadmap tracking, release notes, user-facing docs", pipeline: ["review", "changelog"], subdirs: ["changelogs", "standards", "reports", "inbox"], mustNotTouch: "Application code, infrastructure, design files" },
  content:  { focus: "Content calendar, analytics reporting, contributor docs", pipeline: ["review", "report"], subdirs: ["reports", "standards", "inbox"], mustNotTouch: "Application code, infrastructure, content" },
  devtools: { focus: "Changelog, migration guides, API docs, semver tracking", pipeline: ["review", "changelog"], subdirs: ["changelogs", "standards", "reports", "inbox"], mustNotTouch: "Application code, infrastructure, design" },
  homelab:  { focus: "Device inventory, integration docs, troubleshooting guides", pipeline: ["review", "report"], subdirs: ["reports", "standards", "inbox"], mustNotTouch: "Application code, infrastructure, design" },
  data:     { focus: "Data catalog, lineage documentation, SLA tracking", pipeline: ["review", "report"], subdirs: ["reports", "standards", "inbox"], mustNotTouch: "Application code, infrastructure, design" },
});

// --- BOARD ---
addDept("board", {
  game:     { focus: "Strategic direction, game portfolio planning", pipeline: ["synthesize", "coordinate", "document"], subdirs: ["minutes", "strategy", "inbox"], mustNotTouch: "Application code, infrastructure" },
  saas:     { focus: "Product strategy, market positioning, prioritization", pipeline: ["synthesize", "coordinate", "document"], subdirs: ["minutes", "strategy", "inbox"], mustNotTouch: "Application code, infrastructure" },
  content:  { focus: "Content strategy, audience growth, editorial direction", pipeline: ["synthesize", "coordinate", "document"], subdirs: ["minutes", "strategy", "inbox"], mustNotTouch: "Application code, infrastructure" },
  devtools: { focus: "Developer ecosystem strategy, integration priorities", pipeline: ["synthesize", "coordinate", "document"], subdirs: ["minutes", "strategy", "inbox"], mustNotTouch: "Application code, infrastructure" },
  homelab:  { focus: "Lab strategy, device priorities, expansion planning", pipeline: ["synthesize", "coordinate", "document"], subdirs: ["minutes", "strategy", "inbox"], mustNotTouch: "Application code, infrastructure" },
  data:     { focus: "Data strategy, source prioritization, compliance", pipeline: ["synthesize", "coordinate", "document"], subdirs: ["minutes", "strategy", "inbox"], mustNotTouch: "Application code, infrastructure" },
});

// --- DEVOPS (game, saas, devtools, homelab, data) ---
addDept("devops", {
  game:     { focus: "CI/CD pipelines, build automation, deployment scripts, game builds", pipeline: ["audit-ci", "design-pipeline", "implement", "verify"], subdirs: ["pipelines", "builds", "audits", "inbox"], mustNotTouch: "Game logic, CSS, design tokens" },
  saas:     { focus: "CI/CD pipelines, build automation, deployment, release management", pipeline: ["audit-ci", "design-pipeline", "implement", "verify"], subdirs: ["pipelines", "builds", "audits", "inbox"], mustNotTouch: "Application code, UI components, design tokens" },
  devtools: { focus: "Release pipeline, build automation, package publishing, CI/CD", pipeline: ["audit-ci", "design-pipeline", "implement", "verify"], subdirs: ["pipelines", "builds", "audits", "inbox"], mustNotTouch: "Core SDK code, documentation, design" },
  homelab:  { focus: "Deployment automation, container builds, update pipelines", pipeline: ["audit-ci", "design-pipeline", "implement", "verify"], subdirs: ["pipelines", "builds", "audits", "inbox"], mustNotTouch: "Application code, dashboard UI, IoT protocols" },
  data:     { focus: "ETL pipeline automation, data builds, scheduling CI", pipeline: ["audit-ci", "design-pipeline", "implement", "verify"], subdirs: ["pipelines", "builds", "audits", "inbox"], mustNotTouch: "ETL logic, dashboard code, data transforms" },
});

// --- QA (game, saas, devtools, data) ---
addDept("qa", {
  game:     { focus: "Game testing, play-testing, regression suites, bug tracking", pipeline: ["test-plan", "execute", "report"], subdirs: ["test-plans", "results", "bugs", "inbox"], mustNotTouch: "Game code, CSS, infrastructure, deployment" },
  saas:     { focus: "Feature testing, API testing, regression suites, bug tracking", pipeline: ["test-plan", "execute", "report"], subdirs: ["test-plans", "results", "bugs", "inbox"], mustNotTouch: "Application code, infrastructure, design" },
  devtools: { focus: "CLI/SDK testing, integration tests, compatibility matrix", pipeline: ["test-plan", "execute", "report"], subdirs: ["test-plans", "results", "bugs", "inbox"], mustNotTouch: "Core code, infrastructure, documentation" },
  data:     { focus: "Data quality testing, pipeline validation, schema tests", pipeline: ["test-plan", "execute", "report"], subdirs: ["test-plans", "results", "bugs", "inbox"], mustNotTouch: "ETL code, dashboards, infrastructure" },
});

// --- IT (all templates) ---
addDept("it", {
  game:     { focus: "Internal tooling, system monitoring, log management, file hygiene", pipeline: ["scan", "maintain", "report"], subdirs: ["scans", "maintenance", "inbox"], mustNotTouch: "Game code, design files, deployment configs" },
  saas:     { focus: "Internal tooling, system monitoring, dependency management, file hygiene", pipeline: ["scan", "maintain", "report"], subdirs: ["scans", "maintenance", "inbox"], mustNotTouch: "Application code, UI, deployment configs" },
  content:  { focus: "CMS tooling, media management, system monitoring, file hygiene", pipeline: ["scan", "maintain", "report"], subdirs: ["scans", "maintenance", "inbox"], mustNotTouch: "Content files, editorial, design" },
  devtools: { focus: "Internal tooling, dependency audits, system monitoring", pipeline: ["scan", "maintain", "report"], subdirs: ["scans", "maintenance", "inbox"], mustNotTouch: "SDK code, documentation, release pipeline" },
  homelab:  { focus: "System monitoring, device health, log management, file hygiene", pipeline: ["scan", "maintain", "report"], subdirs: ["scans", "maintenance", "inbox"], mustNotTouch: "Integration code, dashboard, Docker configs" },
  data:     { focus: "System monitoring, dependency management, tooling maintenance", pipeline: ["scan", "maintain", "report"], subdirs: ["scans", "maintenance", "inbox"], mustNotTouch: "ETL code, dashboards, pipeline configs" },
});

// --- SECURITY (saas, devtools, homelab, data) ---
addDept("security", {
  saas:     { focus: "Vulnerability scanning, dependency audits, CSP headers, access control", pipeline: ["scan", "assess", "harden", "verify"], subdirs: ["scans", "assessments", "hardening", "inbox"], mustNotTouch: "Application code, UI, business logic" },
  devtools: { focus: "Supply chain security, dependency audits, package integrity", pipeline: ["scan", "assess", "harden", "verify"], subdirs: ["scans", "assessments", "hardening", "inbox"], mustNotTouch: "Core code, documentation, UI" },
  homelab:  { focus: "Network security, container scanning, access control, firewall rules", pipeline: ["scan", "assess", "harden", "verify"], subdirs: ["scans", "assessments", "hardening", "inbox"], mustNotTouch: "Application code, dashboard, automation rules" },
  data:     { focus: "Data access security, encryption audits, compliance, PII scanning", pipeline: ["scan", "assess", "harden", "verify"], subdirs: ["scans", "assessments", "hardening", "inbox"], mustNotTouch: "ETL code, dashboards, pipeline logic" },
});

// --- HR (saas only) ---
addDept("hr", {
  saas:     { focus: "Department onboarding, SLA tracking, retrospectives, culture", pipeline: ["review", "assess", "recommend"], subdirs: ["reviews", "assessments", "retros", "inbox"], mustNotTouch: "Application code, infrastructure, design, security" },
});

// --- ANALYTICS (game, saas, content, devtools, data) ---
addDept("analytics", {
  game:     { focus: "Player behavior analytics, session tracking, game popularity metrics", pipeline: ["collect", "analyze", "report", "recommend"], subdirs: ["reports", "analyses", "recommendations", "inbox"], mustNotTouch: "Game code, design, infrastructure" },
  saas:     { focus: "User behavior analytics, feature usage, conversion tracking", pipeline: ["collect", "analyze", "report", "recommend"], subdirs: ["reports", "analyses", "recommendations", "inbox"], mustNotTouch: "Application code, infrastructure, design" },
  content:  { focus: "Reader analytics, content performance, engagement metrics", pipeline: ["collect", "analyze", "report", "recommend"], subdirs: ["reports", "analyses", "recommendations", "inbox"], mustNotTouch: "Content files, infrastructure, design" },
  devtools: { focus: "Developer adoption metrics, API usage, feature popularity", pipeline: ["collect", "analyze", "report", "recommend"], subdirs: ["reports", "analyses", "recommendations", "inbox"], mustNotTouch: "Core code, infrastructure, documentation" },
  data:     { focus: "Pipeline metrics, data quality scores, SLA compliance tracking", pipeline: ["collect", "analyze", "report", "recommend"], subdirs: ["reports", "analyses", "recommendations", "inbox"], mustNotTouch: "ETL code, dashboards, infrastructure" },
});

// --- EDITORIAL (content only) ---
addDept("editorial", {
  content:  { focus: "Content quality, style guide enforcement, editorial standards", pipeline: ["review", "edit", "publish"], subdirs: ["reviews", "drafts", "published", "inbox"], mustNotTouch: "Application code, infrastructure, design system code" },
});

// --- Resolve template → department list ---

function resolveTemplate(template: string): Record<string, DeptDef> {
  const deptNames = TEMPLATE_DEPTS[template];
  if (!deptNames) { console.error(`Unknown template '${template}'`); process.exit(1); }
  const result: Record<string, DeptDef> = {};
  for (const dept of deptNames) {
    if (CSUITE_DEFS[dept]) {
      result[dept] = CSUITE_DEFS[dept];
    } else if (DEPT_CATALOG[template]?.[dept]) {
      result[dept] = DEPT_CATALOG[template][dept];
    } else {
      console.error(`Bug: department '${dept}' not defined for template '${template}'`);
      process.exit(1);
    }
  }
  return result;
}

// --- CLI ---

function usage() {
  console.log(`Usage: bun scaffold.ts --name <project> --path <dir> --template <template>

Templates: ${Object.keys(TEMPLATE_DEPTS).join(", ")}

Each template includes core departments (${CORE_DEPTS.join(", ")})
plus template-specific ones:
${Object.entries(TEMPLATE_DEPTS).map(([t, d]) => `  ${t}: +${d.filter(x => !CORE_DEPTS.includes(x)).join(", ") || "(none)"}`).join("\n")}

Options:
  --name       Project name (used in file names and cron jobs)
  --path       Directory to create the project in
  --template   Company template to use
  --help       Show this help`);
}

function parseArgs(): { name: string; path: string; template: string } {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) { usage(); process.exit(0); }
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : ""; };
  const name = get("--name"), path = get("--path"), template = get("--template");
  if (!name || !path || !template) { console.error("Error: --name, --path, and --template are required"); process.exit(1); }
  if (!TEMPLATE_DEPTS[template]) { console.error(`Error: Unknown template '${template}'. Available: ${Object.keys(TEMPLATE_DEPTS).join(", ")}`); process.exit(1); }
  return { name, path, template };
}

// --- Generators ---

const CSUITE_TOOLS: Record<string, string> = {
  ceo: `## Tools
Use these scripts for your work (run via cron data-collection or manually):
- \`csuite-report.ts --role ceo\` — full company report with all dept grades, escalations, pipeline
- \`grade.ts --dept <dept> --grade <A-F> --reason "..."\` — grade a department, writes review
- \`board-meeting.ts\` — collect summaries, generate board meeting minutes
- \`inbox-send.ts --to <dept> --from ceo --priority <p> --title "..." --body "..."\` — send directives
- \`activity-log.ts --query --since 12h\` — check recent activity across departments
`,
  cto: `## Tools
- \`csuite-report.ts --role cto\` — technical report: R&D + Infra + IT artifacts, specs, tech debt
- \`read-artifacts.ts --dept rnd,infra,it --format summary\` — scan technical department artifacts
- \`inbox-send.ts --to <dept> --from cto --priority <p> --title "..." --body "..."\` — send technical directives
- \`state-rw.ts --read pipeline\` — check pipeline status

## Oversight Scope
You oversee: R&D, Infra, IT. You do NOT oversee: UX/UI, PM, Board, Security, HR, Analytics.
`,
  ciso: `## Tools
- \`csuite-report.ts --role ciso\` — security report: audits, security inbox items, vulnerability patterns
- \`read-artifacts.ts --dept security,infra --format summary\` — scan security-relevant artifacts
- \`inbox-send.ts --to <dept> --from ciso --priority <p> --title "..." --body "..."\` — send security directives

## Oversight Scope
You oversee: Security, Infra (security aspects). You advise all departments on security matters.
`,
  cpo: `## Tools
- \`csuite-report.ts --role cpo\` — product report: UX/UI designs, staleness score, user-facing artifacts
- \`staleness-check.ts\` — check UX/UI design freshness, keyword repetition, style rotation
- \`read-artifacts.ts --dept uxui --format summary\` — scan design artifacts
- \`inbox-send.ts --to <dept> --from cpo --priority <p> --title "..." --body "..."\` — send product directives

## Oversight Scope
You oversee: UX/UI. You advise R&D on user-facing features and PM on product documentation.
`,
};

function generateSystemMd(deptName: string, dept: DeptDef): string {
  const pipelineStr = dept.pipeline.join(" → ");
  let md = `# ${deptName.toUpperCase()} Department\n\n## Identity\nYou are the ${deptName.toUpperCase()} department. Your focus: ${dept.focus}.\n\n## Pipeline\n\`${pipelineStr}\`\n\nFollow this pipeline strictly. Do NOT skip steps.\n`;
  if (dept.mustNotTouch) {
    md += `\n## Boundaries\nYou MUST NOT touch: ${dept.mustNotTouch}\n`;
  }
  md += `\n## Anti-Slop Contract\n- No filler words: leverage, utilize, enhance, streamline, robust, seamless\n- No vague reports -- every claim must have a specific example\n- No placeholders -- every TODO must be resolved before shipping\n- No generic names: data, result, thing → use domain-specific names\n- Every sentence must carry information\n- If nothing useful to do, say "No actionable work this cycle" and stop\n`;

  // C-Suite gets tool references
  if (CSUITE_TOOLS[deptName]) {
    md += `\n${CSUITE_TOOLS[deptName]}`;
  }

  md += `\n## Confluence\nYou may write to \`confluence/\` when you make a decision, discover a technical insight, or create a reusable procedure.\nCategories: decisions/, technical/, runbooks/, postmortems/.\nFollow the template in CORPORATE.md. File naming: \`<YYYY-MM-DD>-<slug>.md\`.\n`;

  return md;
}

function generateCorporateMd(name: string, deptNames: string[]): string {
  return `# ${name} -- Corporate Governance

## Execution Order
${deptNames.map((d, i) => `${i + 1}. ${d}`).join("\n")}

## Rules
1. Every department follows its mandatory pipeline -- no skipping steps
2. Cross-department work goes through inbox delegation only
3. CEO inspects and grades all departments twice daily
4. Anti-slop contract is enforced in every department
5. State coordination via state.json -- read before acting, update after acting
6. Minimum 15-minute gap between department runs
7. If nothing useful to do, say so and stop -- no filler output

## Confluence (Shared Knowledge Base)
All departments may write to \`confluence/\` — the project's shared wiki.

### Categories
- \`confluence/decisions/\` — Architecture Decision Records (ADRs). Why we chose X over Y.
- \`confluence/technical/\` — Deep-dives, how things work, gotchas.
- \`confluence/runbooks/\` — Operational procedures anyone might need.
- \`confluence/postmortems/\` — Incident analysis: what went wrong, root cause, action items.

### Document Template
\`\`\`markdown
# <Title>
**Author**: <department> | **Date**: <YYYY-MM-DD> | **Status**: draft | approved | superseded

## Context
## Decision / Content
## Consequences
## References
\`\`\`

### Rules
- File naming: \`<YYYY-MM-DD>-<slug>.md\`
- No restating what's already in a spec/design — link to the original
- Decisions must explain WHY, not just WHAT
- Runbooks must have exact commands — no vague instructions
- PM tracks confluence docs in changelogs and reports
`;
}

function generateDelegationMd(): string {
  return `# Delegation Protocol

## Inbox Format
All inter-department tasks go to: \`departments/<dept>/inbox/<timestamp>-<topic>.md\`

\`\`\`markdown
# Task: <title>
Priority: high|medium|low
From: <department>
Deadline: next cycle | 2 cycles | when ready

## What
<specific description>

## Acceptance Criteria
- [ ] <testable criterion>

## Context
<why, references>
\`\`\`

## Rules
- Process inbox at start of every run
- Move completed items to inbox/done/
- Stale items (>3 cycles) escalate to CEO
`;
}

function generateStateJson(deptNames: string[]): string {
  const directives: Record<string, string> = {};
  const grades: Record<string, string> = {};
  for (const d of deptNames) { directives[d] = ""; grades[d] = ""; }
  return JSON.stringify({
    version: "2.0.0", system: "corporate-on-demand",
    lastBoardMeeting: null, lastCEOInspection: null,
    ceoDirectives: directives, departmentGrades: grades,
    pipeline: { researched: [], pitched: [], specced: [], built: [] },
    pendingEscalations: [], recentChanges: [], blockedTasks: [],
    fastTrack: null, incidentMode: null, meetings: [], metrics: {},
    budgets: {}, slaContracts: [],
    confluence: { totalDocs: 0, lastUpdated: null, byCategory: { decisions: 0, technical: 0, runbooks: 0, postmortems: 0 } },
    style_palette: { current: "", history: [], maxConsecutive: 3 },
  }, null, 2);
}

function generateDataScript(projectName: string, projectPath: string, deptName: string, subdirs: string[]): string {
  const artifactDirs = subdirs.filter(d => d !== "inbox");
  return `#!/bin/bash
# Data collection for ${projectName} ${deptName} department
PROJ="${projectPath}"
DEPT="$PROJ/departments/${deptName}"

echo "=== CORPORATE GOVERNANCE ==="
cat "$PROJ/departments/CORPORATE.md"

echo "=== DEPARTMENT IDENTITY ==="
cat "$DEPT/SYSTEM.md"

echo "=== INBOX ==="
for f in "$DEPT/inbox"/*.md; do [ -f "$f" ] && echo "--- $f ---" && cat "$f"; done

${artifactDirs.map(d => `echo "=== ${d.toUpperCase()} ==="
for f in "$DEPT/${d}"/*.md; do [ -f "$f" ] && echo "--- $f ---" && cat "$f"; done`).join("\n\n")}

echo "=== SHARED STATE ==="
cat "$PROJ/state.json"
`;
}

function generateCsuiteDataScript(projectName: string, projectPath: string, role: string): string {
  const home = process.env.HOME || "~";
  return `#!/bin/bash
# Data collection for ${projectName} ${role} (C-Suite)
PROJ="${projectPath}"
SCRIPTS="${home}/.hermes/skills/devops/corporate-on-demand/scripts"
BUN="${home}/.bun/bin/bun"

echo "=== CORPORATE GOVERNANCE ==="
cat "$PROJ/departments/CORPORATE.md"

echo "=== DEPARTMENT IDENTITY ==="
cat "$PROJ/departments/${role}/SYSTEM.md"

echo "=== INBOX ==="
for f in "$PROJ/departments/${role}/inbox"/*.md; do [ -f "$f" ] && echo "--- $f ---" && cat "$f"; done

echo "=== C-SUITE REPORT ==="
$BUN "$SCRIPTS/csuite-report.ts" --path "$PROJ" --role ${role} 2>/dev/null || echo "(csuite-report.ts not available)"

echo "=== SHARED STATE ==="
cat "$PROJ/state.json"
`;
}

// --- Schedules ---

function generateSchedules(deptNames: string[]): Record<string, string> {
  const schedules: Record<string, string> = {};

  // C-Suite fixed schedules
  schedules["ceo"] = "0 10,22 * * *";
  schedules["cto"] = "0 4,16 * * *";
  schedules["ciso"] = "0 6,18 * * *";
  schedules["cpo"] = "0 8,20 * * *";
  schedules["board"] = "0 21 * * *";

  // Regular departments: staggered every 2h
  const regularDepts = deptNames.filter(d => !schedules[d]);
  const offsets = [0, 25, 50, 75, 100];
  regularDepts.forEach((d, i) => {
    const mins = offsets[i % offsets.length];
    schedules[d] = `${mins} */2 * * *`;
  });

  return schedules;
}

// --- Main ---

const { name, path: projectPath, template } = parseArgs();
const departments = resolveTemplate(template);

if (existsSync(projectPath)) { console.error(`Error: ${projectPath} already exists`); process.exit(1); }

// Create project structure
mkdirSync(join(projectPath, "departments"), { recursive: true });
mkdirSync(join(projectPath, "logs"), { recursive: true });

// Create confluence (shared knowledge base)
for (const cat of ["decisions", "technical", "runbooks", "postmortems"]) {
  mkdirSync(join(projectPath, "confluence", cat), { recursive: true });
}

const deptNames = Object.keys(departments);

// Create department directories
for (const [deptName, dept] of Object.entries(departments)) {
  const deptDir = join(projectPath, "departments", deptName);
  for (const sub of dept.subdirs) {
    mkdirSync(join(deptDir, sub), { recursive: true });
  }
  if (dept.subdirs.includes("inbox")) {
    mkdirSync(join(deptDir, "inbox", "done"), { recursive: true });
  }
  writeFileSync(join(deptDir, "SYSTEM.md"), generateSystemMd(deptName, dept));
}

// Write governance docs
writeFileSync(join(projectPath, "departments", "CORPORATE.md"), generateCorporateMd(name, deptNames));
writeFileSync(join(projectPath, "departments", "DELEGATION.md"), generateDelegationMd());
writeFileSync(join(projectPath, "state.json"), generateStateJson(deptNames));

// Create data-collection scripts
const hermesScriptsDir = join(process.env.HOME || "~", ".hermes", "scripts");
mkdirSync(hermesScriptsDir, { recursive: true });

for (const [deptName, dept] of Object.entries(departments)) {
  const scriptPath = join(hermesScriptsDir, `${name}-${deptName}.sh`);
  const script = CSUITE_ROLES.includes(deptName)
    ? generateCsuiteDataScript(name, projectPath, deptName)
    : generateDataScript(name, projectPath, deptName, dept.subdirs);
  writeFileSync(scriptPath, script, { mode: 0o755 });
  console.log(`Created: ${scriptPath}`);
}

console.log(`\n✅ Scaffolded "${name}" at ${projectPath} using template "${template}"`);
console.log(`\nDepartments: ${deptNames.join(", ")}`);
console.log(`\n📋 Create cron jobs with:`);

const schedules = generateSchedules(deptNames);

for (const d of deptNames) {
  console.log(`\nhermes cron create --name ${name}-${d} --schedule "${schedules[d]}" --script ${name}-${d}.sh --workdir ${projectPath} --toolsets terminal,file --deliver telegram`);
}
