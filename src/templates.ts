/**
 * Starter departments.
 *
 * The three workers are a seed read from a template file, not a hardcoded
 * literal in the command layer. Adding a department means adding a JSON file
 * under templates/departments/, with no code change.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeFailure } from "./errors";
import { Department, type Department as DepartmentType } from "./workspace";

const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "templates", "departments");

/** Free models only. A paid model must be an explicit choice, never a default. */
export const DEFAULT_MODEL = "opencode/space-bunny-free";

export const STARTER_DEPARTMENT = "engineering";

/**
 * Load a department template by name. Throws a RuntimeFailure naming the file
 * when it is missing, because a silent empty department would look like a
 * successful init that hired nobody.
 */
export function loadDepartmentTemplate(name: string): DepartmentType {
  const file = join(TEMPLATE_DIR, `${name}.json`);
  if (!existsSync(file)) {
    throw new RuntimeFailure(
      `department template "${name}" not found at ${file}; available templates are in ${TEMPLATE_DIR}`,
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const result = Department.safeParse(parsed);
  if (!result.success) {
    throw new RuntimeFailure(`${file} is not a valid department: ${result.error.message}`);
  }
  return result.data;
}

export function loadStarterDepartment(): DepartmentType {
  return loadDepartmentTemplate(STARTER_DEPARTMENT);
}

/** Every department template available on disk, sorted for stable output. */
export function listDepartmentTemplates(): string[] {
  if (!existsSync(TEMPLATE_DIR)) return [];
  return readdirSync(TEMPLATE_DIR)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.replace(/\.json$/, ""))
    .sort();
}
