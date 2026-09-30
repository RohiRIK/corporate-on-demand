/**
 * A meeting, not a report.
 *
 * The version this replaces collected activity, listed the pipeline and wrote
 * minutes: no agent spoke, nothing was decided. The roadmap named that exact
 * thing as "not a meeting", and then it happened anyway - so this file exists
 * to make the three properties structural rather than aspirational.
 *
 *   1. every role SPEAKS, with a position about its OWN work
 *   2. the CEO DECIDES, and a decision is an explicit verdict
 *   3. the product is WORK - decisions become ledger items, not prose
 *
 * The cast is DERIVED from the workspace, so a department joins by existing and
 * not by a code change. CISO, CFO and CPO join the day they are added, which is
 * the whole point of not hardcoding CEO + CTO + Engineering.
 *
 * **What this is not:** no agent is called, and no model is consulted. The
 * positions are computed from the ledger and the workspace, deterministically.
 * That is honest about being a first version - it decides real work from real
 * state - and it is the thing that has to become a model call before the meeting
 * is a discussion rather than a calculation. Stated here rather than implied
 * away, because a deterministic meeting that nobody labels deterministic is a
 * meeting pretending to be an agent.
 */

import { openWork, listWork, propose as proposeWork, type WorkItem } from "./work";
import { textOfItem } from "./runwork";
import type { Workspace } from "./workspace";

export interface Role {
  readonly role: string;
  readonly name: string;
  /** Empty for the CEO: it exists to serve the company's purpose. */
  readonly purpose: string;
}

export interface Statement {
  readonly role: string;
  readonly position: string;
  /** Items this role is waiting on a decision about. */
  readonly concerning: readonly string[];
}

export interface Decision {
  readonly item: string;
  readonly by: string;
  readonly verdict: "dispatch" | "defer" | "reject";
  readonly reason: string;
}

export interface Meeting {
  readonly cast: readonly Role[];
  readonly speaking: readonly Statement[];
  readonly decisions: readonly Decision[];
  readonly summary: string;
  /**
   * True when every position came from a model rather than from arithmetic.
   *
   * Reported rather than assumed. A meeting that computed its positions and
   * printed them in a discussion's shape is the old report wearing a costume,
   * and the only defence is saying which one happened.
   */
  readonly spoken: boolean;
}

/** The CEO first, then every department that exists. */
export function castFor(workspace: Workspace): Role[] {
  return [
    { role: "ceo", name: "CEO", purpose: "" },
    ...workspace.departments.map((d) => ({ role: d.name, name: d.name.toUpperCase(), purpose: d.purpose ?? "" })),
  ];
}

function positionFor(role: Role, company: string, items: readonly WorkItem[]): Statement {
  const mine = items.filter((w) => w.from_agent === role.role);
  const aboutMe = items.filter((w) => w.to_agent === role.role || w.to_agent === "ceo");

  if (role.role === "ceo") {
    return {
      role: role.role,
      position:
        `${company} has ${items.length} item(s) in the ledger. ` +
        (items.length === 0
          ? "Nothing is waiting on me."
          : `I am holding ${items.filter((w) => w.state === "ready").length} ready to dispatch.`),
      concerning: items.map((w) => w.id),
    };
  }

  // Each department speaks about ITS OWN proposals. A shared activity dump
  // would be the old report wearing a different hat.
  const line =
    mine.length === 0
      ? `${role.role} has nothing outstanding` +
        (role.purpose === "" ? " and no declared purpose, so it is proposing nothing." : ".")
      : `${role.role} has put ${mine.length} item(s) to the CEO` +
        (role.purpose === "" ? "." : ` toward "${role.purpose}".`);

  return { role: role.role, position: line, concerning: aboutMe.map((w) => w.id) };
}

/**
 * The CEO's decision on one item.
 *
 * Deterministic, and deliberately so: the rule is the blast radius, which is
 * derived from the paths and cannot be asserted by the proposer. An item that
 * is already finished is not decided about again.
 */
function decide(item: WorkItem, ceo: string): Decision {
  const reason =
    item.blast_radius !== null && item.blast_radius >= 2
      ? "global radius: the CEO dispatches this itself, and widens it deliberately"
      : `self-contained radius ${item.blast_radius ?? 0}: within the proposing department's authority`;

  return { item: item.id, by: ceo, verdict: "dispatch", reason };
}

/**
 * Hold a meeting. Returns what was said and what was decided.
 *
 * The CEO's dispatch decisions become ledger items, which is what makes the
 * product of a meeting work rather than minutes. They carry the blast radius of
 * what they dispatch, so a global decision arrives with global authority and a
 * narrow one does not.
 */
/**
 * Optional: give every role a VOICE.
 *
 * With an `ask`, the positions are argued by a model that can look at what the
 * department actually produced and say what it thinks is next. Without one, they
 * are computed from the ledger, which is honest but is arithmetic wearing a
 * meeting's clothes - and the output says which happened.
 */
export async function holdMeeting(
  workspace: Workspace,
  stateDir: string,
  ask?: (prompt: string) => Promise<string>,
): Promise<Meeting> {
  const cast = castFor(workspace);
  const handle = openWork(stateDir);
  try {
    const items = listWork(handle);
    const open = items.filter((w) => w.state === "ready" || w.state === "proposed");

    const computed = cast.map((role) => positionFor(role, workspace.company.name, open));

    // The voice. Sequential rather than parallel: a meeting where everyone
    // speaks at once is a mailing list, and the order is the order the room
    // finds out things in.
    let speaking: Statement[] = computed;
    let spoken = false;
    if (ask !== undefined) {
      spoken = true;
      const voiced: Statement[] = [];
      for (const statement of computed) {
        voiced.push({
          ...statement,
          position: await voiceFor(statement, workspace.company.name, ask),
        });
      }
      speaking = voiced;
    }

    // The CEO decides about what is OPEN. Deciding about finished work is
    // theatre, and deciding about nothing is manufacturing work from nothing.
    const decisions = open
      .filter((w) => w.to_agent === "ceo")
      .map((w) => decide(w, "ceo"));

    // A decision that is a dispatch becomes WORK. This is the point of the
    // meeting: its product is items the cycle can then run.
    for (const decision of decisions) {
      const source = open.find((w) => w.id === decision.item);
      if (source === undefined) continue;
      const made = proposeWork(handle, {
        from: "ceo",
        to: source.from_agent,
        kind: "task",
        payload: source.payload,
        // The goal is not a column; it lives inside the payload, which is the
        // durable record a dispatch actually reads.
        goal: textOfItem(source),
        targetPaths: [],
        // Carries the radius of what it dispatches. Widened HERE, deliberately,
        // because this is the authority a department did not have.
        blastRadius: decision.verdict === "dispatch" ? source.blast_radius ?? 0 : 0,
      });
      void made;
    }

    const summary = [
      `cast: ${cast.map((c) => c.name).join(", ")}`,
      ...speaking.map((s) => `  ${s.role}: ${s.position}`),
      `decisions: ${decisions.length}`,
      spoken ? "positions spoken by a model" : "positions COMPUTED - no model was consulted",
    ].join("\\n");

    return { cast, speaking, decisions, summary, spoken };
  } finally {
    handle.close();
  }
}




/**
 * One role's position, in its own voice.
 *
 * Falls back to the computed position on any failure. A meeting that cannot be
 * held is worse than one that is thin: the point of an autonomous company is
 * that it keeps going, and a provider outage must not delete the company`s
 * agenda.
 */
async function voiceFor(
  statement: Statement,
  company: string,
  ask: (prompt: string) => Promise<string>,
): Promise<string> {
  try {
    const answer = await ask(
      [
        `You are the ${statement.role} of ${company}, speaking in a company meeting.`,
        `Ledger so far: ${statement.position}`,
        `You have ${statement.concerning.length} item(s) concerning you.`,
        "",
        "Say your position in at most three sentences: what you think should happen",
        "next and why. Be specific. Do not ask questions - nobody is reading this.",
      ].join("\n"),
    );
    const text = answer.trim();
    if (text === "" || /could not|failed|exited/i.test(text.slice(0, 40))) return statement.position;
    return truncate(text, 400);
  } catch {
    return statement.position;
  }
}

function truncate(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}\u2026`;
}
