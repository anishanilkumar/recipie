import { describe, expect, it } from "vitest";
import cases from "../../shared/timing-cases.json";
import { stepChip, timingFacts, totals } from "./timing";
import type { Step } from "./types";

describe("shared timing cases", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(totals(c.steps as Step[])).toEqual(c.expect);
    });
  }
});

describe("display", () => {
  const steps: Step[] = [
    { id: "1", text: "Mix", kind: "active", minutes: 20 },
    { id: "2", text: "Bake", kind: "passive", timer_seconds: 3600, oven: true },
    { id: "3", text: "Cool", kind: "setting", minutes: 480 },
  ];
  it("lists the facts", () => {
    expect(timingFacts(steps)).toEqual(["Start to finish 1 h 20 min", "Hands-on 20 min", "Oven 1 h", "Setting 8 h"]);
  });
  it("says nothing for a recipe without kinds", () => {
    expect(timingFacts([{ id: "1", text: "Boil", timer_seconds: 60 }])).toEqual([]);
  });
  it("names the oven on the chip", () => {
    expect(stepChip(steps[1])).toBe("Passive · oven · 1 h");
  });
});
