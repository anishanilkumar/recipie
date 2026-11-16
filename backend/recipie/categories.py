"""The household's recipe categories: the short row of kinds on the recipe list.

A category is a tag with a place in that row: a recipe is in "Rice cooker"
when it carries the tag "rice cooker" (case, hyphens and spaces don't matter,
as in the apps' tagKey). So the categories need no field of their own, recipes
already tagged fall into them, and every tag stays searchable.

The list itself is the household's, kept here so every device shows the same
row; it is edited from either app or by Claude.
"""

from __future__ import annotations

import json
import re

from .db import closing, connect, write_tx

DEFAULT = ["Baking", "Rice cooker", "Curry", "Oven", "Noodles"]
MAX = 20


def key(name: str) -> str:
    """"Rice-Cooker", "rice cooker" -> "rice cooker". Mirrors tagKey in browse.ts / Browse.kt."""
    return re.sub(r"[-_\s]+", " ", name.strip().lower())


def get() -> list[str]:
    with closing(connect()) as conn:
        r = conn.execute("SELECT value FROM household WHERE key = 'categories'").fetchone()
    return json.loads(r["value"]) if r else list(DEFAULT)


def put(names: list[str]) -> list[str]:
    """Replace the list: trimmed, in the order given, without repeats."""
    out: list[str] = []
    seen: set[str] = set()
    for n in names:
        n = re.sub(r"\s+", " ", str(n)).strip()
        if not n:
            continue
        if len(n) > 40:
            raise ValueError(f"{n[:40]}… is too long for a category (40 characters).")
        if key(n) in seen:
            continue
        seen.add(key(n))
        out.append(n)
    if len(out) > MAX:
        raise ValueError(f"At most {MAX} categories.")
    with write_tx() as conn:
        conn.execute(
            "INSERT INTO household (key, value) VALUES ('categories', ?) "
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            (json.dumps(out),),
        )
    return out
