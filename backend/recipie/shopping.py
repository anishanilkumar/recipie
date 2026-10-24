"""An event's shopping list, worked out from its menu.

Every dish that still has to be cooked adds its ingredients: a linked
recipe's, scaled from the recipe's servings to that day's headcount, and any
typed in for the event as they are. Rows with the same name and unit are
summed, so rice for both days is one line, with where each part came from.

Only the server computes this. The shared page is online, and the PWA asks
for the list rather than keeping a second copy of these rules in TypeScript.
"""

from __future__ import annotations

# Same quantity, smaller unit, so "2 kg" typed in and "500 g" from a recipe
# land on one line.
_BASE = {"kg": ("g", 1000.0), "l": ("ml", 1000.0), "litre": ("ml", 1000.0), "liter": ("ml", 1000.0)}


def key(name: str, unit: str) -> str:
    return f"{' '.join(name.casefold().split())}|{unit.casefold().strip()}"


def _norm(amount: float | None, unit: str) -> tuple[float | None, str]:
    base = _BASE.get(unit.casefold().strip())
    if base is None:
        return amount, unit.strip()
    to, k = base
    return (None if amount is None else amount * k), to


def effective_status(dish: dict, dish_status: dict) -> str:
    """What a visitor last set wins; the household resets it by changing the menu (events.save)."""
    over = dish_status.get(dish["id"])
    return over["status"] if over else dish.get("status", "todo")


def build(doc: dict, recipes: dict[str, dict], *, dish_status: dict | None = None,
          checks: dict | None = None) -> dict:
    """{"items": [...], "warnings": [...]} for one event.

    `recipes` maps recipe id to its document (only the ones the menu links).
    Hidden rows are returned too, flagged, so the menu editor can bring them
    back; the shared page leaves them out.
    """
    dish_status = dish_status or {}
    checks = checks or {}
    hidden = set(doc.get("hidden_keys", []))
    rows: dict[str, dict] = {}
    warnings: list[str] = []

    def add(name: str, amount, unit: str, alt_amount, alt_unit: str, *, optional: bool, source: dict, scaled: bool):
        amount, unit = _norm(amount, unit or "")
        k = key(name, unit)
        row = rows.get(k)
        if row is None:
            row = rows[k] = {
                "key": k, "name": name.strip(), "amount": None, "unit": unit,
                "alt_amount": None, "alt_unit": alt_unit or "", "_alt_ok": True,
                "optional": optional, "unmeasured": False, "not_scaled": False, "sources": [],
            }
        # Needed by any dish means needed.
        row["optional"] = row["optional"] and optional
        if amount is None:
            row["unmeasured"] = True
        else:
            row["amount"] = (row["amount"] or 0) + amount
        # The kitchen measure only adds up while every part uses the same one.
        if alt_amount is None or (alt_unit or "") != row["alt_unit"]:
            row["_alt_ok"] = False
        elif row["_alt_ok"]:
            row["alt_amount"] = (row["alt_amount"] or 0) + alt_amount
        if not scaled:
            row["not_scaled"] = True
        row["sources"].append(source)

    for day in doc.get("days", []):
        headcount = day.get("headcount")
        for dish in day.get("dishes", []):
            if effective_status(dish, dish_status) == "already_made":
                continue
            src = {"day": day["label"], "dish": dish["name"], "dish_id": dish["id"]}
            rid = dish.get("recipe_id")
            if rid:
                recipe = recipes.get(rid)
                if recipe is None:
                    warnings.append(f"{dish['name']} ({day['label']}): its recipe is no longer in the book.")
                else:
                    servings = recipe.get("servings")
                    scaled = bool(headcount and servings)
                    factor = headcount / servings if scaled else 1.0
                    if not scaled:
                        why = "no headcount for the day" if not headcount else "the recipe has no servings"
                        warnings.append(f"{dish['name']} ({day['label']}): not scaled, {why}.")
                    for ing in recipe.get("ingredients", []):
                        a, alt = ing.get("amount"), ing.get("alt_amount")
                        add(ing["name"], None if a is None else a * factor, ing.get("unit", ""),
                            None if alt is None else alt * factor, ing.get("alt_unit", ""),
                            optional=ing.get("role") == "optional",
                            source={**src, "factor": round(factor, 2)}, scaled=scaled)
            for item in dish.get("extra_ingredients", []):
                add(item["name"], item.get("amount"), item.get("unit", ""), None, "",
                    optional=False, source=src, scaled=True)

    items = []
    for row in rows.values():
        ok = row.pop("_alt_ok")
        if not ok:
            row["alt_amount"], row["alt_unit"] = None, ""
        tick = checks.get(row["key"])
        row["checked"] = bool(tick and tick["checked"])
        row["checked_by"] = tick["by"] if tick and tick["checked"] else ""
        row["hidden"] = row["key"] in hidden
        items.append(row)
    items.sort(key=lambda r: (r["optional"], r["name"].casefold()))
    return {"items": items, "warnings": warnings}
