import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { assess, type Verdict } from "./cookable";
import { ARRIVED_KEY, CATEGORIES_KEY, DEFAULT_CATEGORIES, db, getKV, getPantry, OPENED_KEY } from "./db";
import { EVENTS_KEY } from "./sync";
import type { EventSummary, LocalRecipe, PantrySnapshot } from "./types";

export function usePantry(): PantrySnapshot | undefined {
  return useLiveQuery(() => getPantry(), []);
}

export interface RecipeWithVerdict {
  recipe: LocalRecipe;
  verdict: Verdict;
}

export function useRecipes(): RecipeWithVerdict[] | undefined {
  const recipes = useLiveQuery(() => db.recipes.filter((r) => !r.deleted).toArray(), []);
  const pantry = usePantry();
  return useMemo(() => {
    if (!recipes) return undefined;
    const stock = pantry?.stock ?? null;
    return recipes
      .map((recipe) => ({ recipe, verdict: assess(recipe.doc, stock) }))
      .sort((a, b) => a.recipe.doc.title.localeCompare(b.recipe.doc.title));
  }, [recipes, pantry]);
}

/** When each recipe was last opened on this device. */
export function useOpened(): Record<string, string> | undefined {
  return useLiveQuery(async () => (await getKV<Record<string, string>>(OPENED_KEY)) ?? {}, []);
}

/** The household's categories; the starting five until the first sync. */
export function useCategories(): string[] {
  return useLiveQuery(async () => (await getKV<string[]>(CATEGORIES_KEY)) ?? DEFAULT_CATEGORIES, []) ?? DEFAULT_CATEGORIES;
}

/** When each recipe first reached this device by sync. */
export function useArrived(): Record<string, string> | undefined {
  return useLiveQuery(async () => (await getKV<Record<string, string>>(ARRIVED_KEY)) ?? {}, []);
}

export function useRecipe(id: string | undefined): LocalRecipe | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.recipes.get(id)) ?? null) : null), [id]);
}

/** Who the server says we are; `demo` is true on the public demo. */
export function useMe(): { username: string; demo: boolean } | undefined {
  return useLiveQuery(() => getKV<{ username: string; demo: boolean }>("me"), []);
}

/** For each recipe, the events whose menu uses it (as of the last sync). */
export function useRecipeEvents(): Map<string, EventSummary[]> {
  const events = useLiveQuery(() => getKV<EventSummary[]>(EVENTS_KEY), []);
  return useMemo(() => {
    const out = new Map<string, EventSummary[]>();
    for (const e of events ?? []) {
      for (const id of e.recipe_ids ?? []) out.set(id, [...(out.get(id) ?? []), e]);
    }
    return out;
  }, [events]);
}
