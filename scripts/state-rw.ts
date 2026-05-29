#!/usr/bin/env bun
// state-rw.ts — Read/write state.json fields atomically
import { parseProjectPath, getArg, hasFlag, readState, writeState } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage:
  bun state-rw.ts --path <project> --read <field>
  bun state-rw.ts --path <project> --write <field>=<value>
  bun state-rw.ts --path <project> --append <field> '<json>'`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);

function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  const target = keys.reduce((o, k) => { if (!o[k]) o[k] = {}; return o[k]; }, obj);
  target[last] = value;
}

function parseValue(v: string): any {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+$/.test(v)) return parseInt(v);
  if (/^\d+\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

if (hasFlag(args, "--read")) {
  const field = getArg(args, "--read");
  const state = readState(projectPath);
  console.log(JSON.stringify(getNestedValue(state, field), null, 2));
} else if (hasFlag(args, "--write")) {
  const expr = getArg(args, "--write");
  const [field, ...rest] = expr.split("=");
  const value = parseValue(rest.join("="));
  const state = readState(projectPath);
  setNestedValue(state, field, value);
  writeState(projectPath, state);
  console.log(`Set ${field} = ${JSON.stringify(value)}`);
} else if (hasFlag(args, "--append")) {
  const field = getArg(args, "--append");
  const idx = args.indexOf("--append");
  const jsonStr = args[idx + 2] || "{}";
  const item = JSON.parse(jsonStr);
  const state = readState(projectPath);
  const arr = getNestedValue(state, field) || [];
  arr.push(item);
  setNestedValue(state, field, arr);
  writeState(projectPath, state);
  console.log(`Appended to ${field}`);
} else {
  console.error("Error: specify --read, --write, or --append");
  process.exit(1);
}
