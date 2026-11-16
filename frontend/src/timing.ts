// How long a recipe takes, by the kind of each step. The same rules as the
// server (backend/recipie/timing.py) and Friday (cook/logic/Timing.kt), held
// to shared/timing-cases.json. Bakes plans its nights from these numbers.

import { minutes as fmt } from "./format";
import type { Step, StepKind } from "./types";

export const KINDS: { value: StepKind; label: string; hint: string }[] = [
  { value: "prep", label: "Prep", hint: "Done ahead, waiting on its own: butter out to room temperature" },
  { value: "active", label: "Active", hint: "Hands on: mix, fold, fill the tins" },
  { value: "passive", label: "Passive", hint: "Waiting while it happens: in the oven, resting" },
  { value: "setting", label: "Setting", hint: "After it's done: overnight on the rack, in the fridge" },
];

export interface Totals {
  prep: number;
  active: number;
  passive: number;
  setting: number;
  /** The active and passive steps before the first setting: start to finish, leaving out prep and setting. */
  bake: number;
  /** Active and passive steps after a setting (wrap the loaf next morning): not in bake. */
  after: number;
  oven: number;
  unclassified: number;
  /** Every step has a kind. */
  classified: boolean;
}

/** A step's length in minutes: its `minutes`, else its timer rounded up, else 0. */
export function stepMinutes(s: Pick<Step, "minutes" | "timer_seconds">): number {
  if (s.minutes) return s.minutes;
  if (s.timer_seconds) return Math.ceil(s.timer_seconds / 60);
  return 0;
}

export function totals(steps: Pick<Step, "kind" | "minutes" | "timer_seconds" | "oven">[]): Totals {
  const t: Totals = { prep: 0, active: 0, passive: 0, setting: 0, bake: 0, after: 0, oven: 0, unclassified: 0, classified: false };
  let set = false;
  for (const s of steps) {
    const m = stepMinutes(s);
    if (s.kind && s.kind in t) t[s.kind] += m;
    else t.unclassified += m;
    if (s.kind === "setting") set = true;
    else if (set && (s.kind === "active" || s.kind === "passive")) t.after += m;
    if (s.oven) t.oven += m;
  }
  t.bake = t.active + t.passive - t.after;
  t.classified = steps.length > 0 && steps.every((s) => !!s.kind);
  return t;
}

/** The recipe's timing facts, for the line under its title; empty when no step has a kind. */
export function timingFacts(steps: Step[]): string[] {
  if (!steps.some((s) => s.kind)) return [];
  const t = totals(steps);
  const out: string[] = [];
  if (t.bake) out.push(`Start to finish ${fmt(t.bake)}`);
  if (t.active) out.push(`Hands-on ${fmt(t.active)}`);
  if (t.oven) out.push(`Oven ${fmt(t.oven)}`);
  if (t.prep) out.push(`Prep ${fmt(t.prep)} ahead`);
  if (t.setting) out.push(`Setting ${fmt(t.setting)}`);
  if (t.after) out.push(`Then ${fmt(t.after)} after`);
  return out;
}

/** A step's chip: "Active · 20 min", "Passive · oven · 1 h". Empty without a kind. */
export function stepChip(s: Step): string {
  if (!s.kind) return "";
  const label = KINDS.find((k) => k.value === s.kind)?.label ?? s.kind;
  const parts = [label];
  if (s.oven) parts.push("oven");
  const m = stepMinutes(s);
  if (m) parts.push(fmt(m));
  return parts.join(" · ");
}
