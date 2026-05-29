#!/usr/bin/env bun
// inbox-send.ts — Write formatted inbox messages
import { writeFileSync } from "fs";
import { join } from "path";
import { parseProjectPath, getArg, hasFlag, getDeptDir, ensureDir, fileTimestamp, isoNow, listDepartments } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun inbox-send.ts --path <project> --to <dept> --from <dept> --priority high|medium|low --title "..." --body "..."`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const to = getArg(args, "--to");
const from = getArg(args, "--from");
const priority = getArg(args, "--priority") || "medium";
const title = getArg(args, "--title");
const body = getArg(args, "--body");

if (!to || !from || !title) { console.error("Error: --to, --from, --title are required"); process.exit(1); }

const depts = listDepartments(projectPath);
if (!depts.includes(to)) { console.error(`Error: department '${to}' not found. Available: ${depts.join(", ")}`); process.exit(1); }

const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
const inboxDir = join(getDeptDir(projectPath, to), "inbox");
ensureDir(inboxDir);
const filename = `${fileTimestamp()}-${slug}.md`;
const filepath = join(inboxDir, filename);

const content = `# Task: ${title}
Priority: ${priority}
From: ${from}
Date: ${isoNow()}

## What
${body || "No details provided."}
`;

writeFileSync(filepath, content);
console.log(`Sent: ${filepath}`);
