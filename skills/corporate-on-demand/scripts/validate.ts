#!/usr/bin/env bun
// validate.ts -- Validate a Corporate-on-Demand project deployment
// Usage: bun validate.ts --path <project-dir>

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function usage() {
  console.log(`Usage: bun validate.ts --path <project-dir>

Validates:
  - CORPORATE.md and DELEGATION.md exist
  - state.json is valid with required fields
  - Each department has SYSTEM.md
  - Each department has required subdirs
  - Inbox files have required headers

Options:
  --path    Path to Corporate-on-Demand project
  --help    Show this help`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) { usage(); process.exit(0); }
const pathIdx = args.indexOf("--path");
const projectPath = pathIdx >= 0 && pathIdx + 1 < args.length ? args[pathIdx + 1] : "";
if (!projectPath) { console.error("Error: --path is required"); process.exit(1); }

let passes = 0, fails = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${name}`); passes++; }
  else { console.log(`  ❌ ${name}${detail ? ` -- ${detail}` : ""}`); fails++; }
}

console.log(`\nValidating: ${projectPath}\n`);

// Project exists
check("Project directory exists", existsSync(projectPath));
if (!existsSync(projectPath)) { console.log(`\n${passes} passed, ${fails} failed`); process.exit(1); }

const depsDir = join(projectPath, "departments");
check("departments/ directory exists", existsSync(depsDir));

// Governance docs
check("CORPORATE.md exists", existsSync(join(depsDir, "CORPORATE.md")));
check("DELEGATION.md exists", existsSync(join(depsDir, "DELEGATION.md")));

// state.json
const statePath = join(projectPath, "state.json");
check("state.json exists", existsSync(statePath));
if (existsSync(statePath)) {
  try {
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    const requiredFields = ["version", "system", "ceoDirectives", "departmentGrades"];
    for (const field of requiredFields) {
      check(`state.json has "${field}"`, field in state);
    }
  } catch (e) {
    check("state.json is valid JSON", false, String(e));
  }
}

// Departments
if (existsSync(depsDir)) {
  const entries = readdirSync(depsDir).filter(e => {
    const p = join(depsDir, e);
    return statSync(p).isDirectory();
  });

  console.log(`\nDepartments found: ${entries.join(", ")}\n`);

  for (const dept of entries) {
    const deptDir = join(depsDir, dept);
    console.log(`[${dept}]`);
    check("SYSTEM.md exists", existsSync(join(deptDir, "SYSTEM.md")));

    // Check for inbox
    const hasInbox = existsSync(join(deptDir, "inbox"));
    check("inbox/ exists", hasInbox);

    // Validate inbox files
    if (hasInbox) {
      const inboxDir = join(deptDir, "inbox");
      const inboxFiles = readdirSync(inboxDir).filter(f => f.endsWith(".md"));
      for (const f of inboxFiles) {
        const content = readFileSync(join(inboxDir, f), "utf-8");
        const hasTitle = /^# Task:/.test(content);
        const hasPriority = /Priority:\s*(high|medium|low)/i.test(content);
        const hasFrom = /From:\s*\S+/.test(content);
        check(`inbox/${f} has required headers`, hasTitle && hasPriority && hasFrom,
          !hasTitle ? "missing '# Task:'" : !hasPriority ? "missing 'Priority:'" : "missing 'From:'");
      }
    }

    // Check SYSTEM.md has anti-slop contract
    const sysMdPath = join(deptDir, "SYSTEM.md");
    if (existsSync(sysMdPath)) {
      const content = readFileSync(sysMdPath, "utf-8");
      check("SYSTEM.md has anti-slop contract", /anti-slop/i.test(content));
      check("SYSTEM.md has pipeline/workflow", dept === "ceo" || /pipeline|workflow/i.test(content));
    }
    console.log("");
  }
}

console.log(`\n${"=".repeat(40)}`);
console.log(`${passes} passed, ${fails} failed`);
process.exit(fails > 0 ? 1 : 0);
