// How the recipe list is ordered and narrowed. Mirrored in Friday
// (cook/logic/Browse.kt); change them together.

import type { LocalRecipe } from "./types";

export type Sort = "recent" | "az";

/** One tag as the list offers it: tags differing only in case or hyphens are one. */
export interface TagChoice {
  key: string;
  label: string;
  count: number;
}

/** "Make-ahead", "make ahead" and "MAKE AHEAD" are the same tag. */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/[-_\s]+/g, " ");
}

export function hasTag(recipe: LocalRecipe, key: string): boolean {
  return (recipe.doc.tags ?? []).some((t) => tagKey(t) === key);
}

/** Every tag in use, most-used first, each shown in its commonest spelling. */
export function tagChoices(recipes: LocalRecipe[]): TagChoice[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const r of recipes) {
    const seen = new Set<string>();
    for (const raw of r.doc.tags ?? []) {
      const key = tagKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const e = byKey.get(key) ?? { count: 0, spellings: new Map() };
      e.count++;
      const s = raw.trim();
      e.spellings.set(s, (e.spellings.get(s) ?? 0) + 1);
      byKey.set(key, e);
    }
  }
  return [...byKey.entries()]
    .map(([key, e]) => ({
      key,
      count: e.count,
      label: [...e.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// Times are parsed, not compared as text: the server writes "+00:00", the browser "Z".
const t = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * New: arrived on this device by sync (someone else, or Claude, added it) and
 * not opened here since. It stays new until opened.
 */
export function isNew(id: string, opened: Record<string, string>, arrived: Record<string, string>): boolean {
  const came = arrived[id];
  return !!came && t(opened[id]) < t(came);
}

/**
 * The household's categories as the list offers them: in their own order, each
 * with how many recipes carry its tag (none is shown too, so the row is steady).
 */
export function categoryChoices(recipes: LocalRecipe[], categories: string[]): TagChoice[] {
  return categories.map((label) => {
    const key = tagKey(label);
    return { key, label, count: recipes.filter((r) => hasTag(r, key)).length };
  });
}

/** Whether "kerala, Rice-cooker" holds the category "Rice cooker". */
export function tagTextHas(tagText: string, category: string): boolean {
  const key = tagKey(category);
  return tagText.split(",").some((t) => tagKey(t) === key);
}

/** Add the category's tag to the comma list, or take it out (any spelling of it). */
export function toggleTagText(tagText: string, category: string): string {
  const key = tagKey(category);
  const tags = tagText.split(",").map((t) => t.trim()).filter(Boolean);
  const kept = tags.filter((t) => tagKey(t) !== key);
  return (kept.length === tags.length ? [...tags, category.toLowerCase()] : kept).join(", ");
}

/**
 * Recent: new recipes first, newest arrival on top; then the last opened on
 * this device. A recipe never opened here goes by when it was last saved.
 */
export function sortRecipes<T extends { recipe: LocalRecipe }>(
  rows: T[], sort: Sort, opened: Record<string, string>, arrived: Record<string, string> = {},
): T[] {
  const title = (r: T) => r.recipe.doc.title;
  if (sort === "az") return [...rows].sort((a, b) => title(a).localeCompare(title(b)));
  const fresh = (r: T) => (isNew(r.recipe.id, opened, arrived) ? t(arrived[r.recipe.id]) : 0);
  const when = (r: T) => t(opened[r.recipe.id] ?? r.recipe.updated_at);
  return [...rows].sort((a, b) => fresh(b) - fresh(a) || when(b) - when(a) || title(a).localeCompare(title(b)));
}
