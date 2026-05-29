// Shared utilities for Corporate-on-Demand scripts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "fs";
import { join, resolve } from "path";

export function parseProjectPath(args: string[]): string {
  const p = getArg(args, "--path");
  if (!p) { console.error("Error: --path is required"); process.exit(1); }
  const resolved = resolve(p);
  if (!existsSync(resolved)) { console.error(`Error: project path does not exist: ${resolved}`); process.exit(1); }
  return resolved;
}

export function getArg(args: string[], flag: string): string {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : "";
}

export function getArgList(args: string[], flag: string): string[] {
  const v = getArg(args, flag);
  return v ? v.split(",").map(s => s.trim()).filter(Boolean) : [];
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export function readState(projectPath: string): any {
  const p = join(projectPath, "state.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf-8"));
}

export function writeState(projectPath: string, state: any): void {
  const lockPath = join(projectPath, "state.json.lock");
  const start = Date.now();
  while (existsSync(lockPath)) {
    if (Date.now() - start > 5000) { console.error("Error: state.json lock timeout"); process.exit(1); }
    Bun.sleepSync(50);
  }
  try {
    writeFileSync(lockPath, String(process.pid));
    writeFileSync(join(projectPath, "state.json"), JSON.stringify(state, null, 2));
  } finally {
    try { unlinkSync(lockPath); } catch {}
  }
}

export function listMdFiles(dir: string): { name: string; path: string; mtime: Date; size: number }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => {
      const fp = join(dir, f);
      const st = statSync(fp);
      return { name: f, path: fp, mtime: st.mtime, size: st.size };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export function listDepartments(projectPath: string): string[] {
  const deptDir = join(projectPath, "departments");
  if (!existsSync(deptDir)) return [];
  return readdirSync(deptDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

export function getDeptDir(projectPath: string, dept: string): string {
  return join(projectPath, "departments", dept);
}

export function isoNow(): string { return new Date().toISOString(); }

export function fileTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

export function parseSince(since: string): Date {
  if (!since) return new Date(0);
  const m = since.match(/^(\d+)h$/);
  if (m) { const d = new Date(); d.setHours(d.getHours() - parseInt(m[1])); return d; }
  return new Date(since);
}

export function truncate(text: string, maxLen = 200): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + "...";
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
