"""Can this be cooked with what is in the pantry right now?

The same rules run in the browser (frontend/src/cookable.ts) so the badge
works offline against the last pantry snapshot. Both implementations are
tested against shared/cookable-cases.json; change the rules in both places
and add a case there.

Per ingredient:
    have       linked to a Grocy product that is in stock
    swap       not in stock, but one of its listed substitutes is
    missing    linked, not in stock, no substitute in stock
    untracked  not linked to Grocy, so there is nothing to check

Per recipe:
    no       a main ingredient is missing, or more than two problems
    unknown  nothing blocks it, but a main ingredient is untracked
    almost   one or two problems
    ready    nothing missing

A "problem" is a missing minor ingredient, or a main ingredient that only a
substitute covers. Optional ingredients never count, and an untracked minor
ingredient (salt, water) is assumed to be in the kitchen.
"""

from __future__ import annotations

from typing import Mapping

MAX_PROBLEMS_FOR_ALMOST = 2


def _in_stock(product_id, stock: Mapping[int, float]) -> bool:
    return product_id is not None and stock.get(int(product_id), 0) > 0


def ingredient_state(ing: Mapping, stock: Mapping[int, float]) -> tuple[str, str | None]:
    """Return (state, substitute name when state is 'swap')."""
    pid = ing.get("grocy_product_id")
    if _in_stock(pid, stock):
        return "have", None
    for sub in ing.get("substitutes") or []:
        if _in_stock(sub.get("grocy_product_id"), stock):
            return "swap", sub["name"]
    if pid is None:
        return "untracked", None
    return "missing", None


def assess(doc: Mapping, stock: Mapping[int, float] | None) -> dict:
    """Assess one recipe document against a {product_id: amount} snapshot.

    `stock=None` means no snapshot has ever been fetched: the answer is
    unknown, not "everything is missing".
    """
    if stock is None:
        return {"status": "unknown", "problems": 0, "missing_main": [], "missing": [], "swaps": [], "untracked_main": []}

    missing_main, missing, swaps, untracked_main = [], [], [], []
    problems = 0
    for ing in doc.get("ingredients") or []:
        role = ing.get("role") or "minor"
        if role == "optional":
            continue
        state, sub = ingredient_state(ing, stock)
        if state == "have":
            continue
        if state == "swap":
            swaps.append({"ingredient": ing["name"], "use": sub})
            if role == "main":
                problems += 1
        elif state == "untracked":
            if role == "main":
                untracked_main.append(ing["name"])
        elif role == "main":
            missing_main.append(ing["name"])
        else:
            missing.append(ing["name"])
            problems += 1

    if missing_main or problems > MAX_PROBLEMS_FOR_ALMOST:
        status = "no"
    elif untracked_main:
        status = "unknown"
    elif problems:
        status = "almost"
    else:
        status = "ready"
    return {
        "status": status,
        "problems": problems,
        "missing_main": missing_main,
        "missing": missing,
        "swaps": swaps,
        "untracked_main": untracked_main,
    }
