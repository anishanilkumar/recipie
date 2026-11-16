import { describe, expect, it } from "vitest";
import { hasTag, isNew, sortRecipes, tagChoices, tagKey } from "./browse";
import type { LocalRecipe } from "./types";

const r = (id: string, title: string, tags: string[], updated_at = "2026-01-01T00:00:00Z"): { recipe: LocalRecipe } => ({
  recipe: { id, rev: 1, deleted: false, updated_at, updated_by: "", dirty: 0, localVersion: 0, doc: { title, tags, ingredients: [], steps: [] } },
});

describe("tags", () => {
  it("folds case and hyphens", () => {
    expect(tagKey(" Make-ahead ")).toBe("make ahead");
    expect(tagKey("make ahead")).toBe("make ahead");
  });

  it("counts each recipe once and shows the commonest spelling", () => {
    const rows = [r("a", "A", ["kerala", "Kerala"]), r("b", "B", ["kerala", "dessert"]), r("c", "C", ["Kerala"])];
    const choices = tagChoices(rows.map((x) => x.recipe));
    expect(choices[0]).toEqual({ key: "kerala", label: "kerala", count: 3 });
    expect(choices[1]).toEqual({ key: "dessert", label: "dessert", count: 1 });
    expect(hasTag(rows[2].recipe, "kerala")).toBe(true);
  });
});

describe("sortRecipes", () => {
  const rows = [
    r("old", "Banana bread", [], "2026-01-01T00:00:00Z"),
    r("new", "Appam", [], "2026-06-01T00:00:00+00:00"),
    r("opened", "Dal", [], "2025-01-01T00:00:00Z"),
  ];

  it("puts the last opened first, then by last saved", () => {
    const ids = sortRecipes(rows, "recent", { opened: "2026-11-01T00:00:00Z" }).map((x) => x.recipe.id);
    expect(ids).toEqual(["opened", "new", "old"]);
  });

  it("puts new arrivals above everything until they're opened", () => {
    const arrived = { old: "2026-11-10T00:00:00Z" };
    const ids = sortRecipes(rows, "recent", { opened: "2026-11-01T00:00:00Z" }, arrived).map((x) => x.recipe.id);
    expect(ids).toEqual(["old", "opened", "new"]);
    expect(isNew("old", {}, arrived)).toBe(true);
    expect(isNew("old", { old: "2026-11-12T00:00:00Z" }, arrived)).toBe(false);
    expect(isNew("new", {}, arrived)).toBe(false);
  });

  it("A–Z ignores opens", () => {
    const ids = sortRecipes(rows, "az", { opened: "2026-11-01T00:00:00Z" }).map((x) => x.recipe.id);
    expect(ids).toEqual(["new", "old", "opened"]);
  });
});
