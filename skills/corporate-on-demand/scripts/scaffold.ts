#!/usr/bin/env bun
// scaffold.ts -- Scaffold a new Corporate-on-Demand project
// Usage: bun scaffold.ts --name <project> --path <dir> --template <template>
// Templates: game, saas, content, devtools, homelab, data

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, basename } from "path";

const TEMPLATES: Record<string, { departments: Record<string, { focus: string; pipeline: string[]; subdirs: string[]; mustNotTouch: string }> }> = {
  game: {
    departments: {
      ceo: { focus: "Quality oversight, play-testing, grading all departments A-F", pipeline: ["directives", "reviews"], subdirs: ["directives", "reviews", "inbox"], mustNotTouch: "" },
      rnd: { focus: "Game design, mechanics, JS/Canvas game development", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox"], mustNotTouch: "CSS, design tokens, layout files, Docker configs" },
      uxui: { focus: "Game UI, CSS design system, player experience", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "Game logic, backend routes, Docker configs" },
      infra: { focus: "Docker hosting, Nginx, health monitoring, deployment", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "Application code, game logic, CSS" },
      pm: { focus: "Game documentation, changelogs, submission standards", pipeline: ["review", "changelog"], subdirs: ["changelogs", "standards", "reports", "inbox"], mustNotTouch: "Application code, infrastructure, design files" },
      board: { focus: "Strategic direction, game portfolio planning", pipeline: ["synthesize", "coordinate", "document"], subdirs: ["minutes", "strategy", "inbox"], mustNotTouch: "Application code, infrastructure" },
    },
  },
  saas: {
    departments: {
      ceo: { focus: "Quality oversight, product review, customer perspective", pipeline: ["directives", "reviews"], subdirs: ["directives", "reviews", "inbox"], mustNotTouch: "" },
      rnd: { focus: "Feature development, API design, backend/frontend code", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox"], mustNotTouch: "CSS design tokens, infrastructure configs, deployment scripts" },
      uxui: { focus: "Product design, user flows, responsive UI, accessibility", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "Backend logic, API routes, database schemas" },
      infra: { focus: "Cloud infrastructure, CI/CD, monitoring, scaling", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "Application code, UI components, business logic" },
      pm: { focus: "Roadmap tracking, release notes, user-facing docs", pipeline: ["review", "changelog"], subdirs: ["changelogs", "standards", "reports", "inbox"], mustNotTouch: "Application code, infrastructure, design files" },
      board: { focus: "Product strategy, market positioning, prioritization", pipeline: ["synthesize", "coordinate", "document"], subdirs: ["minutes", "strategy", "inbox"], mustNotTouch: "Application code, infrastructure" },
    },
  },
  content: {
    departments: {
      ceo: { focus: "Quality oversight, content strategy, reader perspective", pipeline: ["directives", "reviews"], subdirs: ["directives", "reviews", "inbox"], mustNotTouch: "" },
      rnd: { focus: "Publishing tools, editor features, content APIs", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox"], mustNotTouch: "Content files, editorial decisions, design tokens" },
      uxui: { focus: "Reader experience, typography, content layout", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "Backend code, editorial content, infrastructure" },
      editorial: { focus: "Content quality, style guide enforcement, editorial standards", pipeline: ["review", "edit", "publish"], subdirs: ["reviews", "drafts", "published", "inbox"], mustNotTouch: "Application code, infrastructure, design system code" },
      infra: { focus: "CDN, media storage, performance, caching", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "Application code, content, design files" },
      pm: { focus: "Content calendar, analytics reporting, contributor docs", pipeline: ["review", "report"], subdirs: ["reports", "standards", "inbox"], mustNotTouch: "Application code, infrastructure, content" },
    },
  },
  devtools: {
    departments: {
      ceo: { focus: "Quality oversight, dogfooding, developer perspective", pipeline: ["directives", "reviews"], subdirs: ["directives", "reviews", "inbox"], mustNotTouch: "" },
      rnd: { focus: "CLI/SDK development, API design, plugin architecture", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox"], mustNotTouch: "Documentation site, release pipeline configs" },
      uxui: { focus: "Developer experience, documentation site, error messages", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "Core CLI/SDK code, release pipeline, package configs" },
      infra: { focus: "Release pipeline, package registry, CI/CD, versioning", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "Application code, documentation content" },
      pm: { focus: "Changelog, migration guides, API docs, semver tracking", pipeline: ["review", "changelog"], subdirs: ["changelogs", "standards", "reports", "inbox"], mustNotTouch: "Application code, infrastructure, design" },
      board: { focus: "Developer ecosystem strategy, integration priorities", pipeline: ["synthesize", "coordinate", "document"], subdirs: ["minutes", "strategy", "inbox"], mustNotTouch: "Application code, infrastructure" },
    },
  },
  homelab: {
    departments: {
      ceo: { focus: "Quality oversight, real-world testing, reliability focus", pipeline: ["directives", "reviews"], subdirs: ["directives", "reviews", "inbox"], mustNotTouch: "" },
      rnd: { focus: "Integration development, protocol bridges, automation rules", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox"], mustNotTouch: "Docker configs, dashboard UI, network configs" },
      uxui: { focus: "Dashboard design, mobile-friendly UI, status visualization", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "Integration code, Docker configs, IoT protocols" },
      infra: { focus: "Docker Swarm/Compose, IoT networking, monitoring, backups", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "Application code, dashboard UI, automation rules" },
      pm: { focus: "Device inventory, integration docs, troubleshooting guides", pipeline: ["review", "report"], subdirs: ["reports", "standards", "inbox"], mustNotTouch: "Application code, infrastructure, design" },
    },
  },
  data: {
    departments: {
      ceo: { focus: "Quality oversight, data accuracy verification, SLA review", pipeline: ["directives", "reviews"], subdirs: ["directives", "reviews", "inbox"], mustNotTouch: "" },
      rnd: { focus: "ETL development, data transforms, pipeline logic", pipeline: ["research", "pitch", "spec", "build"], subdirs: ["research", "pitches", "specs", "prototypes", "inbox"], mustNotTouch: "Dashboard UI, orchestration configs, infrastructure" },
      uxui: { focus: "Dashboards, data visualization, report templates", pipeline: ["research", "design", "build"], subdirs: ["research", "designs", "styleguide", "inbox"], mustNotTouch: "ETL code, pipeline logic, orchestration configs" },
      infra: { focus: "Pipeline orchestration, storage, scheduling", pipeline: ["audit", "runbook", "execute"], subdirs: ["runbooks", "audits", "inbox"], mustNotTouch: "ETL logic, dashboard code, transform code" },
      pm: { focus: "Data catalog, lineage documentation, SLA tracking", pipeline: ["review", "report"], subdirs: ["reports", "standards", "inbox"], mustNotTouch: "Application code, infrastructure, design" },
      board: { focus: "Data strategy, source prioritization, compliance", pipeline: ["synthesize", "coordinate", "document"], subdirs: ["minutes", "strategy", "inbox"], mustNotTouch: "Application code, infrastructure" },
    },
  },
};

function usage() {
  console.log(`Usage: bun scaffold.ts --name <project> --path <dir> --template <template>

Templates: ${Object.keys(TEMPLATES).join(", ")}

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
  if (!TEMPLATES[template]) { console.error(`Error: Unknown template '${template}'. Available: ${Object.keys(TEMPLATES).join(", ")}`); process.exit(1); }
  return { name, path, template };
}

function generateSystemMd(deptName: string, dept: { focus: string; pipeline: string[]; mustNotTouch: string }): string {
  const pipelineStr = dept.pipeline.join(" → ");
  let md = `# ${deptName.toUpperCase()} Department\n\n## Identity\nYou are the ${deptName.toUpperCase()} department. Your focus: ${dept.focus}.\n\n## Pipeline\n\`${pipelineStr}\`\n\nFollow this pipeline strictly. Do NOT skip steps.\n`;
  if (dept.mustNotTouch) {
    md += `\n## Boundaries\nYou MUST NOT touch: ${dept.mustNotTouch}\n`;
  }
  md += `\n## Anti-Slop Contract\n- No filler words: leverage, utilize, enhance, streamline, robust, seamless\n- No vague reports -- every claim must have a specific example\n- No placeholders -- every TODO must be resolved before shipping\n- No generic names: data, result, thing → use domain-specific names\n- Every sentence must carry information\n- If nothing useful to do, say "No actionable work this cycle" and stop\n`;
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

${artifactDirs.map(d => `echo "=== ${d.toUpperCase()} ==="\nfor f in "$DEPT/${d}"/*.md; do [ -f "$f" ] && echo "--- $f ---" && cat "$f"; done`).join("\n\n")}

echo "=== SHARED STATE ==="
cat "$PROJ/state.json"
`;
}

// --- Main ---
const { name, path: projectPath, template } = parseArgs();
const tmpl = TEMPLATES[template];

if (existsSync(projectPath)) { console.error(`Error: ${projectPath} already exists`); process.exit(1); }

// Create project structure
mkdirSync(join(projectPath, "departments"), { recursive: true });
mkdirSync(join(projectPath, "logs"), { recursive: true });

const deptNames = Object.keys(tmpl.departments);

// Create department directories
for (const [deptName, dept] of Object.entries(tmpl.departments)) {
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

for (const [deptName, dept] of Object.entries(tmpl.departments)) {
  const scriptPath = join(hermesScriptsDir, `${name}-${deptName}.sh`);
  writeFileSync(scriptPath, generateDataScript(name, projectPath, deptName, dept.subdirs), { mode: 0o755 });
  console.log(`Created: ${scriptPath}`);
}

console.log(`\n✅ Scaffolded "${name}" at ${projectPath} using template "${template}"`);
console.log(`\nDepartments: ${deptNames.join(", ")}`);
console.log(`\n📋 Create cron jobs with:`);

const schedules: Record<string, string> = {};
const offsets = [0, 25, 50, 75, 100];
deptNames.filter(d => d !== "ceo").forEach((d, i) => {
  const mins = offsets[i % offsets.length];
  schedules[d] = `${mins} */2 * * *`;
});
schedules["ceo"] = "0 10,22 * * *";

for (const d of deptNames) {
  console.log(`\nhermes cron create --name ${name}-${d} --schedule "${schedules[d] || "0 */2 * * *"}" --script ${name}-${d}.sh --workdir ${projectPath} --toolsets terminal,file --deliver telegram`);
}
