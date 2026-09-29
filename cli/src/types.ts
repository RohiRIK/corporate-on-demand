export type WorkerRole = "builder" | "reviewer" | "tester";

export interface Worker {
  readonly name: string;
  readonly role: WorkerRole;
  readonly model: string;
  /** Cron expression handed to Bun.cron inside the container. */
  readonly schedule: string;
}

export interface Department {
  readonly name: string;
  readonly purpose: string;
  readonly workers: readonly Worker[];
}

export interface Company {
  readonly name: string;
  readonly purpose: string;
  readonly departments: readonly Department[];
}

export interface WorkspaceConfig {
  readonly name: string;
  readonly image: string;
  readonly opencodeVersion: string;
  readonly company: Company;
}

export type CodCommand =
  | "init"
  | "up"
  | "down"
  | "ps"
  | "logs"
  | "doctor"
  | "help"
  | "version";
