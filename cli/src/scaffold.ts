/**
 * scaffold.ts — builds the Company/Department/Worker tree captured by the wizard.
 * `--yes` takes the defaults below; interactive mode prompts on a TTY and
 * fails with a usage error when stdin is not a TTY (no silent guessing).
 */
import { UsageError } from "./exit.ts";
import type { ResolvedConfig } from "./config.ts";
import type { Company, Department, Worker, WorkspaceConfig } from "./types.ts";

export const STARTER_DEPARTMENTS: readonly string[] = ["engineering", "qa", "operations"];

const ROLE_FOR_DEPARTMENT: Readonly<Record<string, readonly Worker["role"][]>> = {
  engineering: ["builder", "reviewer", "tester"],
  qa: ["tester", "reviewer", "builder"],
  operations: ["builder", "tester", "reviewer"],
};

/** Every starter worker runs hourly, staggered by index so they do not collide. */
const SCHEDULE_FOR_INDEX: readonly string[] = [
  "0 * * * *",
  "20 * * * *",
  "40 * * * *",
];

export async function scaffold(
  name: string,
  cfg: ResolvedConfig,
  nonInteractive: boolean,
): Promise<WorkspaceConfig> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) {
    throw new UsageError(
      `Invalid workspace name '${name}'`,
    );
  }

  const answers = nonInteractive
    ? { purpose: `Operate ${name} with autonomous agents.` }
    : await prompt(name);

  const company: Company = {
    name,
    purpose: answers.purpose,
    departments: STARTER_DEPARTMENTS.map((dept) => buildDepartment(dept, cfg)),
  };

  return {
    name,
    image: cfg.image,
    opencodeVersion: cfg.opencodeVersion,
    company,
  };
}

function buildDepartment(dept: string, cfg: ResolvedConfig): Department {
  const roles = ROLE_FOR_DEPARTMENT[dept] ?? ["builder", "reviewer", "tester"];
  const workers: Worker[] = roles.map((role, i) => ({
    name: `${dept}-${role}`,
    role,
    model: cfg.defaultModel,
    schedule: SCHEDULE_FOR_INDEX[i] ?? "0 * * * *",
  }));
  return { name: dept, purpose: `Own ${dept} outcomes for the company.`, workers };
}

interface Answers {
  readonly purpose: string;
}

async function prompt(name: string): Promise<Answers> {
  if (!process.stdin.isTTY) {
    throw new UsageError(
      "init needs a TTY for the wizard; re-run with --yes for defaults",
    );
  }
  process.stderr.write(`Company name [${name}]: `);
  const companyName = (await readLine()).trim() || name;
  process.stderr.write(`Purpose of ${companyName}: `);
  const purpose = (await readLine()).trim();
  if (purpose === "") {
    throw new UsageError("purpose is required");
  }
  return { purpose };
}

async function readLine(): Promise<string> {
  const decoder = new TextDecoder();
  for await (const chunk of process.stdin) {
    void decoder.decode(chunk);
    return decoder.decode(chunk).split("\n")[0] ?? "";
  }
  return "";
}
