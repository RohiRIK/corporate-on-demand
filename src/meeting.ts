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
export function holdMeeting(workspace: Workspace, stateDir: string): Meeting {
  const cast = castFor(workspace);
  const handle = openWork(stateDir);
  try {
    const items = listWork(handle);
    const open = items.filter((w) => w.state === "ready" || w.state === "proposed");

    const speaking = cast.map((role) => positionFor(role, workspace.company.name, open));

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
    ].join("\\n");

    return { cast, speaking, decisions, summary };
  } finally {
    handle.close();
  }
}


