import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { listDepartmentTemplates, loadDepartmentTemplate, starterDepartmentNames } from "../src/templates";
import { Workspace } from "../src/workspace";
import { castFor } from "../src/meeting";

/**
 * CTO has work, and every department has a purpose.
 *
 * Two findings drove this. `cod init` seeded ONE department, engineering, and
 * seeded it with an EMPTY purpose - so the self-proposal cycle correctly
 * proposed nothing, forever, out of the box. A loop that does nothing on a
 * fresh install is worse than no loop, because it looks healthy.
 *
 * And the design already said adding a department means adding a JSON file with
 * no code change - which was true of the loader and false of `init`, which
 * loaded exactly one hardcoded name. The fix is the last step of the design,
 * not a new mechanism.
 */

const CLI = new URL("../src/index.ts", import.meta.url).pathname;

describe("department templates", () => {
  test("CTO exists as a template, so it joins by existing", () => {
    expect(listDepartmentTemplates()).toContain("cto");
  });

  test("every starter department has a REAL purpose", () => {
    // The cycle refuses to propose work for a department with no purpose. That
    // guard is right - but it means an empty purpose ships a company that
    // silently never works.
    for (const name of starterDepartmentNames()) {
      const department = loadDepartmentTemplate(name);
      expect(`${department.purpose}`.trim().length).toBeGreaterThan(10);
    }
  });

  test("CTO is a WORKING role, not a meeting-only attendee", () => {
    const cto = loadDepartmentTemplate("cto");
    expect(cto.purpose.length).toBeGreaterThan(10);
    expect(cto.workers.length).toBeGreaterThan(0);
    expect(cto.workers[0]?.role.length).toBeGreaterThan(0);
  });

  test("a department template's workers all carry a free model", () => {
    for (const name of starterDepartmentNames()) {
      for (const worker of loadDepartmentTemplate(name).workers) {
        expect(worker.model.endsWith(":free") || worker.model.endsWith("-free") || worker.model.endsWith("/free")).toBe(true);
      }
    }
  });
});

describe("cod init", () => {
  test("seeds EVERY starter department, not one hardcoded name", () => {
    const dir = mkdtempSync(join(tmpdir(), "cod-org-"));
    try {
      const proc = spawnSync("bun", ["run", CLI, "init", "acme", "--yes"], {
        cwd: dir, encoding: "utf8", timeout: 180_000,
        env: { ...process.env, COD_WORKSPACE: join(dir, "acme.json"), COD_STATE_DIR: join(dir, "state") },
      });
      expect(proc.status).toBe(0);
      const parsed = Workspace.safeParse(JSON.parse(readFileSync(join(dir, "acme.json"), "utf8")) as unknown);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      const names = parsed.data.departments.map((d) => d.name).sort();
      // Adding a department must mean adding a JSON file. If init still seeded
      // one hardcoded department, cto.json would sit on disk doing nothing.
      expect(names).toEqual(listDepartmentTemplates().sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fresh company can therefore actually MEET with roles to hear", () => {
    const dir = mkdtempSync(join(tmpdir(), "cod-org2-"));
    try {
      spawnSync("bun", ["run", CLI, "init", "acme", "--yes"], {
        cwd: dir, encoding: "utf8", timeout: 180_000,
        env: { ...process.env, COD_WORKSPACE: join(dir, "acme.json"), COD_STATE_DIR: join(dir, "state") },
      });
      const parsed = Workspace.safeParse(JSON.parse(readFileSync(join(dir, "acme.json"), "utf8")) as unknown);
      if (!parsed.success) throw new Error("init produced an invalid workspace");
      const cast = castFor(parsed.data);
      expect(cast.length).toBeGreaterThan(2);
      for (const role of cast.filter((r) => r.role !== "ceo")) {
        expect(role.purpose.trim().length).toBeGreaterThan(10);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
