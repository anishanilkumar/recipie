"""How long a recipe takes, by the kind of each step.

The rules are shared with the web app (frontend/src/timing.ts) and Friday
(cook/logic/Timing.kt); shared/timing-cases.json holds all three to them.
Bakes plans its nights from these numbers.
"""

from __future__ import annotations

import math

KINDS = ("prep", "active", "passive", "setting")


def step_minutes(step: dict) -> int:
    """A step's length: its `minutes`, else its timer rounded up, else 0."""
    if step.get("minutes"):
        return int(step["minutes"])
    if step.get("timer_seconds"):
        return math.ceil(step["timer_seconds"] / 60)
    return 0


def totals(steps: list[dict]) -> dict:
    out = {k: 0 for k in KINDS}
    out["oven"] = 0
    out["unclassified"] = 0
    # Active and passive steps after a setting step happen the next day
    # (wrap the loaf): not part of the bake's start to finish.
    out["after"] = 0
    set_ = False
    for s in steps:
        m = step_minutes(s)
        kind = s.get("kind")
        if kind in KINDS:
            out[kind] += m
        else:
            out["unclassified"] += m
        if kind == "setting":
            set_ = True
        elif set_ and kind in ("active", "passive"):
            out["after"] += m
        if s.get("oven"):
            out["oven"] += m
    out["bake"] = out["active"] + out["passive"] - out["after"]
    out["classified"] = bool(steps) and all(s.get("kind") in KINDS for s in steps)
    return out
