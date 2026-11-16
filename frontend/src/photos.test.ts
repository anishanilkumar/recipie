import { describe, expect, it } from "vitest";
import { licenceLabel, searchTerms } from "./photos";

describe("picture search", () => {
  it("shortens the title, as photos.py did", () => {
    expect(searchTerms("Kerala Egg Puffs (24)")).toEqual(["kerala egg puffs", "egg puffs", "puffs"]);
    expect(searchTerms("Thiruvananthapuram Inji Curry (for 50)")).toEqual(["thiruvananthapuram inji curry", "inji curry", "curry"]);
    expect(searchTerms("Rajma (30)")).toEqual(["rajma"]);
    expect(searchTerms("Basque Burnt Cheesecake, 26 cm tall")).toEqual(["basque burnt cheesecake cm tall", "burnt cheesecake cm tall", "cheesecake cm tall"]);
  });

  it("writes licences as people do", () => {
    expect(licenceLabel("by-nc-nd", "2.0")).toBe("CC BY-NC-ND 2.0");
    expect(licenceLabel("cc0", "1.0")).toBe("CC0");
    expect(licenceLabel("pdm")).toBe("Public domain");
  });
});
