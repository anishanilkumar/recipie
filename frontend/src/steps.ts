// Which ingredients a step uses, so cook mode can show their measurements on
// the step itself.
//
// A step's ingredient_ids are the answer when present (Claude fills them in,
// and the edit screen sets them). Without them, a guess from the step's
// wording: good enough for "Fry the onions", deliberately silent on words
// like "oil" or "powder" that fit half the list.

import type { Ingredient, Step } from "./types";

// Words that describe an ingredient rather than name it. Matching on these
// would tie "heat the oil" to every oil and "add the powders" to every spice.
const GENERIC = new Set([
  "oil", "powder", "paste", "leaves", "leaf", "sauce", "seeds", "seed", "fresh", "dried", "canned",
  "drained", "ground", "whole", "chopped", "sliced", "diced", "minced", "chilled", "frozen", "vegan",
  "hard", "boiled", "green", "red", "white", "black", "fine", "large", "small", "medium", "for",
  "from", "the", "and", "with", "batch", "above", "wash", "glaze", "dusting", "of",
]);

const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, "");

function keywords(name: string): string[] {
  const head = name.toLowerCase().split(/[,(]/)[0];
  return head
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3 && !GENERIC.has(w))
    .map(stem);
}

export function guessStepIngredients(step: Step, ingredients: Ingredient[]): Ingredient[] {
  const words = new Set(step.text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).map(stem));
  return ingredients.filter((ing) => {
    const keys = keywords(ing.name);
    return keys.length > 0 && keys.some((k) => words.has(k));
  });
}

export function stepIngredients(step: Step, ingredients: Ingredient[]): { items: Ingredient[]; guessed: boolean } {
  if (step.ingredient_ids?.length) {
    const ids = new Set(step.ingredient_ids);
    return { items: ingredients.filter((i) => ids.has(i.id)), guessed: false };
  }
  return { items: guessStepIngredients(step, ingredients), guessed: true };
}
