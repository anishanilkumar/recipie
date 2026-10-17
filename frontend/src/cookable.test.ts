import { describe, expect, it } from "vitest";
import cases from "../../shared/cookable-cases.json";
import { assess, reason } from "./cookable";
import type { Ingredient } from "./types";

describe("shared cookable cases", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const got = assess({ ingredients: c.ingredients as Ingredient[] }, c.stock as Record<string, number> | null);
      for (const [key, want] of Object.entries(c.expect)) {
        expect(got[key as keyof typeof got], key).toEqual(want);
      }
    });
  }
});

describe("reason", () => {
  it("names the blocking main ingredient", () => {
    const v = assess(
      { ingredients: [{ id: "1", name: "Chicken", role: "main", grocy_product_id: 1 }] },
      {},
    );
    expect(reason(v)).toBe("No chicken");
  });
  it("lists the small gaps", () => {
    const v = assess(
      {
        ingredients: [
          { id: "1", name: "Chicken", role: "main", grocy_product_id: 1 },
          { id: "2", name: "Coconut oil", grocy_product_id: 2 },
        ],
      },
      { "1": 1 },
    );
    expect(reason(v)).toBe("No coconut oil");
  });
});
