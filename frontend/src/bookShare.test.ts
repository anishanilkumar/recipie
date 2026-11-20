import { describe, expect, it } from "vitest";
import { bookMatches, bookPhotoUrl, type BookRecipe } from "./bookShare";

const r = (id: string, title: string, tags: string[] = [], ingredients: string[] = []): BookRecipe => ({
  id, updated_at: "", doc: { title, tags, ingredients: ingredients.map((name) => ({ name })), steps: [] } as never,
});

const book = [r("1", "Appam", ["Kerala"], ["Rice"]), r("2", "Banana bread", ["baking"], ["Banana"]), r("3", "Rice-cooker dal", ["Rice-Cooker"])];

describe("a friend's book", () => {
  it("narrows by category in any spelling, and by search", () => {
    expect(bookMatches(book, "", "rice cooker").map((x) => x.id)).toEqual(["3"]);
    expect(bookMatches(book, "rice", null).map((x) => x.id)).toEqual(["1", "3"]);
    expect(bookMatches(book, "banana", "baking").map((x) => x.id)).toEqual(["2"]);
    expect(bookMatches(book, "", null)).toHaveLength(3);
  });

  it("fetches photos through the link", () => {
    expect(bookPhotoUrl("rahul-abc")("r1", "web", { v: 7 }, "thumb")).toBe("/api/book/rahul-abc/photos/r1/web/thumb?v=7");
  });
});
