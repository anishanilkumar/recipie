import { describe, expect, it } from "vitest";
import { applyOp, type Op, type Queued } from "./events";
import { bulk } from "./format";
import type { SharedEvent } from "./types";

const at = "2026-10-24T10:00:00Z";

function event(): SharedEvent {
  return {
    version: 3, slug: "lunch-abc234", warnings: [], recipes: {},
    doc: { title: "Lunch", days: [{ id: "d1", label: "Day 1", dishes: [{ id: "puffs", name: "Egg puffs" }] }] },
    shopping: [{
      key: "rice|g", name: "Rice", amount: 3000, unit: "g", alt_amount: null, alt_unit: "",
      optional: false, unmeasured: false, not_scaled: false, sources: [], checked: false, checked_by: "", hidden: false,
    }],
    items: [], notes: [], dish_status: {},
  };
}

const q = (op: Op, by = "Priya"): Queued => ({ ...op, by, at });

describe("applyOp: what the page shows before the server has it", () => {
  it("ticks a worked-out line, and unticks it", () => {
    const ticked = applyOp(event(), q({ kind: "check", key: "rice|g", checked: true }));
    expect(ticked.shopping[0]).toMatchObject({ checked: true, checked_by: "Priya" });
    expect(applyOp(ticked, q({ kind: "check", key: "rice|g", checked: false })).shopping[0].checked_by).toBe("");
  });

  it("adds an item offline that can then be ticked", () => {
    let v = applyOp(event(), q({ kind: "add", id: "milk1234", name: "Oat milk", amount: 2, unit: "l" }));
    v = applyOp(v, q({ kind: "check", item_id: "milk1234", checked: true }, "Sam"));
    expect(v.items).toEqual([expect.objectContaining({ id: "milk1234", added_by: "Priya", checked: true, checked_by: "Sam" })]);
  });

  it("doesn't show an item twice once the server has it", () => {
    const sent = applyOp(event(), q({ kind: "add", id: "milk1234", name: "Oat milk", amount: null, unit: "" }));
    expect(applyOp(sent, q({ kind: "add", id: "milk1234", name: "Oat milk", amount: null, unit: "" })).items).toHaveLength(1);
    expect(applyOp(sent, q({ kind: "remove", id: "milk1234" })).items).toHaveLength(0);
  });

  it("posts notes once and marks dishes", () => {
    const op = q({ kind: "note", id: "n1234567", target: "dish:puffs", text: "Pastry's in the freezer" });
    const v = applyOp(applyOp(event(), op), op);
    expect(v.notes).toHaveLength(1);
    expect(applyOp(v, q({ kind: "dish", dish_id: "puffs", status: "done" })).dish_status.puffs.status).toBe("done");
  });

  it("leaves the original alone", () => {
    const e = event();
    applyOp(e, q({ kind: "check", key: "rice|g", checked: true }));
    expect(e.shopping[0].checked).toBe(false);
  });
});

describe("bulk", () => {
  it("reads large weights and volumes in kg and l", () => {
    expect(bulk(2500, "g")).toBe("2½ kg");
    expect(bulk(750, "g")).toBe("750 g");
    expect(bulk(1500, "ml")).toBe("1½ l");
    expect(bulk(30, "")).toBe("30");
    expect(bulk(null, "g")).toBe("");
  });
});
