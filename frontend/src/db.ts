// The browser's copy of the recipe book. The app reads and writes only this;
// sync.ts moves changes between it and the server in the background, which is
// what makes the app work the same with or without a connection.

import Dexie, { type Table } from "dexie";
import type { LocalRecipe, PantrySnapshot, RecipeDoc } from "./types";
import { newId } from "./types";

interface KV {
  key: string;
  value: unknown;
}

class RecipieDB extends Dexie {
  recipes!: Table<LocalRecipe, string>;
  kv!: Table<KV, string>;

  constructor() {
    super("recipie");
    this.version(1).stores({
      recipes: "id, dirty",
      kv: "key",
    });
  }
}

export const db = new RecipieDB();

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

export const PANTRY_KEY = "pantry";
export const getPantry = () => getKV<PantrySnapshot>(PANTRY_KEY);

/** Save an edit locally; the next sync sends it. */
export async function saveLocal(id: string | null, doc: RecipeDoc): Promise<string> {
  const recipeId = id ?? newId();
  await db.transaction("rw", db.recipes, async () => {
    const existing = await db.recipes.get(recipeId);
    await db.recipes.put({
      id: recipeId,
      rev: existing?.rev ?? 0,
      deleted: false,
      updated_at: new Date().toISOString(),
      updated_by: "",
      doc,
      dirty: 1,
      localVersion: (existing?.localVersion ?? 0) + 1,
    });
  });
  return recipeId;
}

export async function deleteLocal(id: string): Promise<void> {
  await db.transaction("rw", db.recipes, async () => {
    const existing = await db.recipes.get(id);
    if (!existing) return;
    if (existing.rev === 0) {
      // Never reached the server: nothing to tell it.
      await db.recipes.delete(id);
      return;
    }
    await db.recipes.put({ ...existing, deleted: true, dirty: 1, localVersion: existing.localVersion + 1 });
  });
}
