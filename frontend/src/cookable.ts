// Can this be cooked with what's in the pantry? The same rules as
// backend/recipie/cookable.py — both are tested against
// shared/cookable-cases.json, so change them together.
//
// Runs in the browser so the badge works offline against the last pantry
// snapshot, and reacts instantly to edits that haven't synced yet.

import type { Ingredient, Substitute } from "./types";

export type Status = "ready" | "almost" | "no" | "unknown";
export type IngredientState = "have" | "swap" | "missing" | "untracked";

export interface Verdict {
  status: Status;
  /** Missing minor ingredients plus main ingredients only a substitute covers. */
  problems: number;
  missing_main: string[];
  missing: string[];
  swaps: { ingredient: string; use: string }[];
  untracked_main: string[];
}

export type Stock = Record<string, number> | null;

const MAX_PROBLEMS_FOR_ALMOST = 2;

/** Linked Grocy products; also reads the old single `grocy_product_id`. */
export function productIds(item: Pick<Substitute, "grocy_product_ids" | "grocy_product_id">): number[] {
  const ids = [...(item.grocy_product_ids ?? [])];
  if (item.grocy_product_id != null && !ids.includes(item.grocy_product_id)) ids.push(item.grocy_product_id);
  return ids;
}

function anyInStock(item: Pick<Substitute, "grocy_product_ids" | "grocy_product_id">, stock: Record<string, number>): boolean {
  return productIds(item).some((id) => (stock[String(id)] ?? 0) > 0);
}

// Any one linked product in stock is enough: they are pack sizes of the same thing.
export function ingredientState(
  ing: Pick<Ingredient, "grocy_product_ids" | "grocy_product_id" | "substitutes">,
  stock: Record<string, number>,
): { state: IngredientState; use?: string } {
  if (anyInStock(ing, stock)) return { state: "have" };
  for (const sub of ing.substitutes ?? []) {
    if (anyInStock(sub, stock)) return { state: "swap", use: sub.name };
  }
  if (!productIds(ing).length) return { state: "untracked" };
  return { state: "missing" };
}

export function assess(doc: { ingredients: Ingredient[] }, stock: Stock): Verdict {
  const v: Verdict = { status: "unknown", problems: 0, missing_main: [], missing: [], swaps: [], untracked_main: [] };
  if (stock == null) return v;

  let problems = 0;
  for (const ing of doc.ingredients ?? []) {
    const role = ing.role ?? "minor";
    if (role === "optional") continue;
    const { state, use } = ingredientState(ing, stock);
    if (state === "have") continue;
    if (state === "swap") {
      v.swaps.push({ ingredient: ing.name, use: use! });
      if (role === "main") problems++;
    } else if (state === "untracked") {
      if (role === "main") v.untracked_main.push(ing.name);
    } else if (role === "main") {
      v.missing_main.push(ing.name);
    } else {
      v.missing.push(ing.name);
      problems++;
    }
  }

  v.problems = problems;
  if (v.missing_main.length || problems > MAX_PROBLEMS_FOR_ALMOST) v.status = "no";
  else if (v.untracked_main.length) v.status = "unknown";
  else if (problems) v.status = "almost";
  else v.status = "ready";
  return v;
}

/** One short line that says why, for the recipe list. */
export function reason(v: Verdict): string {
  const lower = (s: string) => s.toLowerCase();
  switch (v.status) {
    case "ready":
      return v.swaps.length
        ? `Everything's in. Use ${lower(v.swaps[0].use)} for the ${lower(v.swaps[0].ingredient)}`
        : "Everything's in";
    case "almost":
      // Name the gaps the number counts. A swap that fully covers a minor
      // ingredient isn't one, so it only shows when nothing is missing (then
      // the gap is a main ingredient covered by its substitute).
      if (v.missing.length) return `No ${lower(listOf(v.missing))}`;
      return capitalise(v.swaps.map((s) => `${lower(s.use)} for ${lower(s.ingredient)}`).join(", "));
    case "no":
      if (v.missing_main.length) return `No ${lower(listOf(v.missing_main))}`;
      return `${v.missing.length} things missing`;
    case "unknown":
      return v.untracked_main.length
        ? `Can't check ${lower(listOf(v.untracked_main))}`
        : "Pantry not checked yet";
  }
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const STATUS_LABEL: Record<Status, string> = {
  ready: "Ready",
  almost: "Almost",
  no: "Not tonight",
  unknown: "Can't tell",
};
