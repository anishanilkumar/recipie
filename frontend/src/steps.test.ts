import { describe, expect, it } from "vitest";
import { measures } from "./format";
import { guessStepIngredients, stepIngredients } from "./steps";
import type { Ingredient } from "./types";

const ING: Ingredient[] = [
  { id: "onion", name: "Onions" },
  { id: "oil", name: "Sunflower oil" },
  { id: "chilli", name: "Green chillies" },
  { id: "curry", name: "Curry leaves, fresh" },
  { id: "pastry", name: "Chilled vegan puff pastry (Blätterteig)" },
  { id: "turmeric", name: "Turmeric powder" },
  { id: "potato", name: "Potato" },
];

const names = (xs: Ingredient[]) => xs.map((x) => x.id);

describe("stepIngredients", () => {
  it("uses the step's ingredient_ids, in ingredient order", () => {
    const r = stepIngredients({ id: "s", text: "anything", ingredient_ids: ["oil", "onion"] }, ING);
    expect(names(r.items)).toEqual(["onion", "oil"]);
    expect(r.guessed).toBe(false);
  });

  it("guesses from the wording when there are none", () => {
    const r = stepIngredients({ id: "s", text: "Add green chillies and curry leaves, then the sliced onions." }, ING);
    expect(names(r.items)).toEqual(["onion", "chilli", "curry"]);
    expect(r.guessed).toBe(true);
  });

  it("matches plurals and the significant word of a long name", () => {
    expect(names(guessStepIngredients({ id: "s", text: "Cut the pastry. Boil the potatoes." }, ING))).toEqual(["pastry", "potato"]);
  });

  it("does not tie generic words to ingredients", () => {
    expect(names(guessStepIngredients({ id: "s", text: "Heat the oil and add the powders." }, ING))).toEqual([]);
    expect(names(guessStepIngredients({ id: "s", text: "Add turmeric." }, ING))).toEqual(["turmeric"]);
  });
});

describe("measures", () => {
  it("shows grams and the kitchen measure, both scaled", () => {
    expect(measures({ amount: 70, unit: "g", alt_amount: 5, alt_unit: "tbsp" }, 1)).toEqual({ main: "70 g", alt: "5 tbsp" });
    expect(measures({ amount: 2.5, unit: "g", alt_amount: 0.75, alt_unit: "tsp" }, 2)).toEqual({ main: "5 g", alt: "1½ tsp" });
    expect(measures({ amount: 650, unit: "g", alt_amount: 13, alt_unit: "" }, 1)).toEqual({ main: "650 g", alt: "13" });
    expect(measures({ amount: 10, unit: "g" }, 1)).toEqual({ main: "10 g", alt: "" });
  });
});
