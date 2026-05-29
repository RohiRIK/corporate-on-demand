#!/usr/bin/env bun
// staleness-check.ts — CPO anti-staleness checker for UX/UI
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { parseProjectPath, hasFlag, getDeptDir, listMdFiles, readState } from "./lib/utils.ts";

if (hasFlag(process.argv, "--help")) {
  console.log(`Usage: bun staleness-check.ts --path <project>`);
  process.exit(0);
}

const args = process.argv.slice(2);
const projectPath = parseProjectPath(args);
const uxDir = getDeptDir(projectPath, "uxui");

const allFiles = [
  ...listMdFiles(join(uxDir, "designs")),
  ...listMdFiles(join(uxDir, "styleguide")),
];

if (allFiles.length === 0) { console.log("No UX/UI files found. Staleness: 0/100"); process.exit(0); }

let score = 0;
const breakdown: string[] = [];

// 1. Age check
const now = Date.now();
const staleFiles = allFiles.filter(f => now - f.mtime.getTime() > 7 * 86400000);
const ageScore = Math.round((staleFiles.length / allFiles.length) * 25);
score += ageScore;
breakdown.push(`Age (>7d): ${staleFiles.length}/${allFiles.length} files stale → ${ageScore}/25`);

// 2. Keyword repetition
const wordCounts: Record<string, number> = {};
const designTerms = ["color", "font", "layout", "spacing", "component", "button", "card", "modal", "grid", "flex", "border", "shadow", "palette", "typography", "responsive"];
for (const f of allFiles) {
  const content = readFileSync(f.path, "utf-8").toLowerCase();
  const seen = new Set<string>();
  for (const term of designTerms) {
    if (content.includes(term) && !seen.has(term)) { wordCounts[term] = (wordCounts[term] || 0) + 1; seen.add(term); }
  }
}
const topWords = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
const repetitive = topWords.filter(([, c]) => c / allFiles.length > 0.6).length;
const keywordScore = Math.round((repetitive / 5) * 25);
score += keywordScore;
breakdown.push(`Keyword repetition: ${repetitive}/5 top terms in >60% files → ${keywordScore}/25`);

// 3. Structure similarity
const hashes = allFiles.map(f => {
  const first5 = readFileSync(f.path, "utf-8").split("\n").slice(0, 5).join("\n");
  return createHash("md5").update(first5).digest("hex");
});
const uniqueHashes = new Set(hashes).size;
const dupeScore = Math.round(((allFiles.length - uniqueHashes) / Math.max(allFiles.length, 1)) * 25);
score += dupeScore;
breakdown.push(`Structure similarity: ${allFiles.length - uniqueHashes} duplicates → ${dupeScore}/25`);

// 4. Style palette repetition
const state = readState(projectPath);
let paletteScore = 0;
if (state.style_palette && Array.isArray(state.style_palette)) {
  let maxConsec = 1, cur = 1;
  for (let i = 1; i < state.style_palette.length; i++) {
    if (state.style_palette[i] === state.style_palette[i - 1]) { cur++; maxConsec = Math.max(maxConsec, cur); }
    else cur = 1;
  }
  if (maxConsec > 3) paletteScore = 25;
  else if (maxConsec > 2) paletteScore = 12;
}
score += paletteScore;
breakdown.push(`Style palette repetition: ${paletteScore}/25`);

console.log(`# Staleness Check — UX/UI\n`);
console.log(`Score: ${score}/100 (0=fresh, 100=stale)\n`);
console.log(`## Breakdown`);
for (const b of breakdown) console.log(`- ${b}`);
console.log(`\n## Recommendations`);
if (ageScore > 10) console.log("- Update stale design files (>7 days old)");
if (keywordScore > 10) console.log("- Diversify design vocabulary — too many files share the same terms");
if (dupeScore > 10) console.log("- Review structurally similar files — possible copy-paste");
if (paletteScore > 0) console.log("- Rotate style palette — same style used too many consecutive times");
if (score === 0) console.log("- All clear! Design artifacts are fresh and varied.");
