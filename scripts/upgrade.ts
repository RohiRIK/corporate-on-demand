#!/usr/bin/env bun
// upgrade.ts — 5-gate project upgrade flow
// Usage: bun upgrade.ts --path <project> --action <check|plan|apply|verify>

import { existsSync, readFileSync, readdirSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { parseProjectPath, getArg, hasFlag, readState, writeState, isoNow, ensureDir, listDepartments } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help") || process.argv.length <= 2) {
  console.log(`Usage: bun upgrade.ts --path <project> --action <check|plan|apply|verify>

Actions (5-gate flow):
  check   — Compare project skillVersion against current skill version
  plan    — Generate upgrade plan listing changes between versions
  apply   — Apply safe automated changes (missing dirs, state.json schema)
  verify  — Run structural validation (equivalent to validate.ts)

Options:
  --path    Path to Corporate-on-Demand project
  --action  One of: check, plan, apply, verify
  --help    Show this help`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const action = getArg(args, "--action");

if (!action || !["check", "plan", "apply", "verify"].includes(action)) {
  console.error("Error: --action must be one of: check, plan, apply, verify");
  process.exit(1);
}

// --- Helpers ---

const SKILL_DIR = resolve(dirname(import.meta.path), "..");

function getSkillVersion(): string {
  const skillMd = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
  const m = skillMd.match(/^version:\s*(.+)$/m);
  return m ? m[1].trim() : "unknown";
}

function getProjectVersion(state: any): string {
  return state.skillVersion || state.version || "unknown";
}

function parseChangelog(): { version: string; content: string }[] {
  const clPath = join(SKILL_DIR, "CHANGELOG.md");
  if (!existsSync(clPath)) return [];
  const text = readFileSync(clPath, "utf-8");
  const entries: { version: string; content: string }[] = [];
  const sections = text.split(/^## /m).slice(1);
  for (const section of sections) {
    const vMatch = section.match(/^\[([^\]]+)\]/);
    if (vMatch) {
      entries.push({ version: vMatch[1], content: section.trim() });
    }
  }
  return entries;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// --- Gate 1: CHECK ---
if (action === "check") {
  const state = readState(projectPath);
  const projectVer = getProjectVersion(state);
  const skillVer = getSkillVersion();
  const cmp = compareVersions(projectVer, skillVer);

  console.log(`# Upgrade Check\n`);
  console.log(`Project version:  ${projectVer}`);
  console.log(`Skill version:    ${skillVer}`);
  console.log(`Status:           ${cmp === 0 ? "✅ Up to date" : cmp < 0 ? "⬆️  Upgrade available" : "⚠️  Project ahead of skill"}`);

  if (cmp < 0) {
    const entries = parseChangelog().filter(e => compareVersions(e.version, projectVer) > 0);
    if (entries.length > 0) {
      console.log(`\nVersions between ${projectVer} → ${skillVer}: ${entries.map(e => e.version).join(", ")}`);
    }
    console.log(`\nRun: bun upgrade.ts --path ${projectPath} --action plan`);
  }
  process.exit(0);
}

// --- Gate 2: PLAN ---
if (action === "plan") {
  const state = readState(projectPath);
  const projectVer = getProjectVersion(state);
  const skillVer = getSkillVersion();

  const entries = parseChangelog().filter(e => compareVersions(e.version, projectVer) > 0);
  console.log(`# Upgrade Plan: ${projectVer} → ${skillVer}\n`);

  if (entries.length === 0) {
    console.log("No changelog entries found between versions.");
    process.exit(0);
  }

  for (const entry of entries) {
    console.log(`## ${entry.content}\n`);
  }

  // Analyze what needs to change
  console.log(`\n# Automated Actions (apply will execute these):\n`);
  const actions: string[] = [];

  // Check for missing standard dirs
  const standardDirs = ["departments", "logs", "confluence"];
  for (const dir of standardDirs) {
    if (!existsSync(join(projectPath, dir))) {
      actions.push(`Create missing directory: ${dir}/`);
    }
  }

  // Check departments for missing subdirs
  const depts = listDepartments(projectPath);
  for (const dept of depts) {
    const deptDir = join(projectPath, "departments", dept);
    for (const sub of ["inbox", "inbox/done"]) {
      if (!existsSync(join(deptDir, sub))) {
        actions.push(`Create missing: departments/${dept}/${sub}/`);
      }
    }
  }

  // Check state.json schema
  const schemaFields = ["version", "system", "ceoDirectives", "departmentGrades", "recentChanges", "pendingEscalations", "blockedTasks", "skillVersion"];
  for (const field of schemaFields) {
    if (!(field in state)) {
      actions.push(`Add missing state.json field: ${field}`);
    }
  }

  if (actions.length === 0) {
    console.log("No automated actions needed — manual review only.");
  } else {
    for (const a of actions) console.log(`- ${a}`);
  }

  console.log(`\nRun: bun upgrade.ts --path ${projectPath} --action apply`);
  process.exit(0);
}

// --- Gate 3: APPLY ---
if (action === "apply") {
  const state = readState(projectPath);
  const projectVer = getProjectVersion(state);
  const skillVer = getSkillVersion();
  let changes = 0;

  console.log(`# Applying Upgrade: ${projectVer} → ${skillVer}\n`);

  // Create missing standard dirs
  for (const dir of ["departments", "logs", "confluence"]) {
    const p = join(projectPath, dir);
    if (!existsSync(p)) {
      ensureDir(p);
      console.log(`✅ Created ${dir}/`);
      changes++;
    }
  }

  // Create missing department subdirs
  const depts = listDepartments(projectPath);
  for (const dept of depts) {
    const deptDir = join(projectPath, "departments", dept);
    for (const sub of ["inbox", "inbox/done"]) {
      const p = join(deptDir, sub);
      if (!existsSync(p)) {
        ensureDir(p);
        console.log(`✅ Created departments/${dept}/${sub}/`);
        changes++;
      }
    }
    // Ensure labs/ for R&D departments
    if (dept === "rnd" || dept === "r&d" || dept === "research") {
      const labsDir = join(deptDir, "labs");
      if (!existsSync(labsDir)) {
        ensureDir(labsDir);
        console.log(`✅ Created departments/${dept}/labs/`);
        changes++;
      }
    }
  }

  // Update state.json schema
  const defaults: Record<string, any> = {
    recentChanges: [],
    pendingEscalations: [],
    blockedTasks: [],
    departmentGrades: {},
    ceoDirectives: [],
    metrics: {},
    skillVersion: skillVer,
  };

  for (const [key, defaultVal] of Object.entries(defaults)) {
    if (!(key in state)) {
      state[key] = defaultVal;
      console.log(`✅ Added state.json field: ${key}`);
      changes++;
    }
  }

  // Always update skillVersion
  if (state.skillVersion !== skillVer) {
    state.skillVersion = skillVer;
    console.log(`✅ Updated skillVersion: ${projectVer} → ${skillVer}`);
    changes++;
  }

  state.lastUpgrade = isoNow();
  writeState(projectPath, state);

  console.log(`\n${changes} changes applied.`);
  console.log(`\nRun: bun upgrade.ts --path ${projectPath} --action verify`);
  process.exit(0);
}

// --- Gate 4: VERIFY ---
if (action === "verify") {
  let passes = 0, fails = 0;

  function check(name: string, ok: boolean, detail?: string) {
    if (ok) { console.log(`  ✅ ${name}`); passes++; }
    else { console.log(`  ❌ ${name}${detail ? ` -- ${detail}` : ""}`); fails++; }
  }

  console.log(`\n# Post-Upgrade Verification: ${projectPath}\n`);

  check("Project directory exists", existsSync(projectPath));
  if (!existsSync(projectPath)) { process.exit(1); }

  const depsDir = join(projectPath, "departments");
  check("departments/ exists", existsSync(depsDir));
  check("CORPORATE.md exists", existsSync(join(depsDir, "CORPORATE.md")));
  check("DELEGATION.md exists", existsSync(join(depsDir, "DELEGATION.md")));

  // state.json
  const statePath = join(projectPath, "state.json");
  check("state.json exists", existsSync(statePath));
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      const required = ["version", "system", "ceoDirectives", "departmentGrades", "skillVersion"];
      for (const field of required) {
        check(`state.json has "${field}"`, field in state);
      }
      const skillVer = getSkillVersion();
      check(`skillVersion matches current (${skillVer})`, state.skillVersion === skillVer);
    } catch (e) {
      check("state.json is valid JSON", false, String(e));
    }
  }

  // Departments
  if (existsSync(depsDir)) {
    const entries = readdirSync(depsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const dept of entries) {
      const deptDir = join(depsDir, dept);
      check(`${dept}/SYSTEM.md exists`, existsSync(join(deptDir, "SYSTEM.md")));
      check(`${dept}/inbox/ exists`, existsSync(join(deptDir, "inbox")));
    }
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails > 0 ? 1 : 0);
}
