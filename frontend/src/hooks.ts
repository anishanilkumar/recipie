import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { assess, type Verdict } from "./cookable";
import { db, getPantry } from "./db";
import type { LocalRecipe, PantrySnapshot } from "./types";

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

export function useRecipe(id: string | undefined): LocalRecipe | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.recipes.get(id)) ?? null) : null), [id]);
}
