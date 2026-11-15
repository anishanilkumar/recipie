// One recipe's share link: /s/<title>-<secret>.
//
// The household makes the link from the recipe's page; a recipe has none
// until then. Whoever opens it has no account and no recipe book in this
// browser, so the page asks the server for that one recipe and keeps the
// last copy in localStorage: once opened, it opens again with no signal,
// which is when a recipe is usually wanted.

import { useEffect, useState } from "react";
import { api, HttpError } from "./sync";
import type { RecipeDoc } from "./types";

export interface RecipeShareState {
  enabled: boolean;
  slug: string | null;
  url: string | null;
}

export interface SharedRecipe {
  slug: string;
  updated_at: string;
  doc: RecipeDoc;
}

// --- the household's side ------------------------------------------------------

export const getRecipeShare = (id: string) => api<RecipeShareState>(`/api/recipes/${id}/share`);
export const setRecipeShare = (id: string, body: { enabled?: boolean; rotate?: boolean }) =>
  api<RecipeShareState>(`/api/recipes/${id}/share`, { method: "POST", body: JSON.stringify(body) });

// --- the link ------------------------------------------------------------------

export type SharedPhase = "loading" | "live" | "offline" | "gone";

const key = (slug: string) => `recipie.recipe.${slug}`;

function cached(slug: string): SharedRecipe | null {
  try {
    const s = localStorage.getItem(key(slug));
    return s ? (JSON.parse(s) as SharedRecipe) : null;
  } catch {
    return null;
  }
}

function keep(slug: string, value: SharedRecipe | null) {
  try {
    if (value) localStorage.setItem(key(slug), JSON.stringify(value));
    else localStorage.removeItem(key(slug));
  } catch { /* private mode or full: the page still works, just not offline */ }
}

export function useSharedRecipe(slug: string): { recipe: SharedRecipe | null; phase: SharedPhase } {
  const [state, setState] = useState<{ recipe: SharedRecipe | null; phase: SharedPhase }>(
    () => ({ recipe: cached(slug), phase: "loading" }),
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const recipe = await api<SharedRecipe>(`/api/recipe-share/${encodeURIComponent(slug)}`);
        keep(slug, recipe);
        if (!cancelled) setState({ recipe, phase: "live" });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof HttpError && e.status === 404) {
          // Switched off, replaced or deleted: forget the copy too.
          keep(slug, null);
          setState({ recipe: null, phase: "gone" });
        } else {
          setState((s) => ({ ...s, phase: "offline" }));
        }
      }
    };
    void load();
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      window.removeEventListener("online", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [slug]);

  return state;
}
