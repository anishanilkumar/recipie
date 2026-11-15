"""A recipe's share link: /s/<readable>-<secret>, which opens without a login.

A recipe has no link until the household makes one. The link lives in its own
table, not in the recipe's row, so making, rotating or switching it off never
bumps the recipe's rev or seq: it can't cause a sync conflict, and phones
don't need to pull anything.

Whoever has the link can read the recipe and cook from it, as it stands now
(an edit shows on the link at once). They can't change anything.
"""

from __future__ import annotations

import json
import sqlite3

from .config import settings
from .db import closing, connect, now_iso, write_tx
from .events import NotFound, _secret, readable, split_slug


def share_url(slug: str) -> str:
    return f"{settings().public_url}/s/{slug}"


def _status(r: sqlite3.Row | None) -> dict:
    on = bool(r and r["enabled"])
    return {"enabled": on, "slug": r["slug"] if on else None, "url": share_url(r["slug"]) if on else None}


def status(recipe_id: str) -> dict:
    with closing(connect()) as conn:
        return _status(conn.execute("SELECT * FROM recipe_shares WHERE recipe_id = ?", (recipe_id,)).fetchone())


def set_share(recipe_id: str, *, enabled: bool | None = None, rotate: bool = False) -> dict:
    """Make the link, switch it on or off, or give it a new secret.

    The words in the link are the title when the link was made; renaming the
    recipe doesn't change a link already sent.
    """
    with write_tx() as conn:
        recipe = conn.execute("SELECT deleted, doc FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
        if recipe is None or recipe["deleted"]:
            raise NotFound(recipe_id)
        current = conn.execute("SELECT * FROM recipe_shares WHERE recipe_id = ?", (recipe_id,)).fetchone()
        if current is None:
            if enabled is False:
                return _status(None)
            head = readable(json.loads(recipe["doc"]).get("title", ""), fallback="recipe")
            conn.execute(
                "INSERT INTO recipe_shares (recipe_id, slug, enabled, created_at) VALUES (?, ?, 1, ?)",
                (recipe_id, f"{head}-{_secret()}", now_iso()),
            )
        else:
            head, tail = split_slug(current["slug"])
            if rotate:
                tail = _secret()
            conn.execute(
                "UPDATE recipe_shares SET slug = ?, enabled = ? WHERE recipe_id = ?",
                (f"{head}-{tail}", int(current["enabled"] if enabled is None else enabled), recipe_id),
            )
        return _status(conn.execute("SELECT * FROM recipe_shares WHERE recipe_id = ?", (recipe_id,)).fetchone())


def _public(doc: dict) -> dict:
    """The recipe without the household's pantry links, which mean nothing outside it."""
    def strip(x: dict) -> dict:
        return {k: v for k, v in x.items() if k not in ("grocy_product_ids", "grocy_product_id")}

    out = dict(doc)
    out["ingredients"] = [
        {**strip(i), "substitutes": [strip(s) for s in i.get("substitutes") or []]}
        for i in doc.get("ingredients", [])
    ]
    return out


def by_slug(slug: str) -> dict | None:
    """What a share link opens, or None if it's wrong, switched off, or the recipe is deleted."""
    with closing(connect()) as conn:
        r = conn.execute(
            """SELECT s.slug, r.doc, r.updated_at FROM recipe_shares s JOIN recipes r ON r.id = s.recipe_id
               WHERE s.slug = ? AND s.enabled = 1 AND r.deleted = 0""",
            (slug,),
        ).fetchone()
    if r is None:
        return None
    return {"slug": r["slug"], "updated_at": r["updated_at"], "doc": _public(json.loads(r["doc"]))}
