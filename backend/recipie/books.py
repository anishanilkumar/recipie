"""The whole recipe book, shared with a friend: /b/<name>-<secret>, no login.

Each friend gets a link of their own, named for them ("Rahul"), so one can be
switched off or replaced without touching anyone else's. Whoever has a link
can read every recipe that isn't archived, with its photos, and cook from it.
It is the book as it is now: a recipe added or edited later shows on the link
at once, an archived or deleted one leaves it. They can't change anything,
and the pantry links stay home (shares._public).

The secret is longer than a single recipe's: it opens the whole book.
"""

from __future__ import annotations

import json
import secrets
import sqlite3

from . import categories, photos
from .config import settings
from .db import closing, connect, now_iso, write_tx
from .events import _ALPHABET, NotFound, readable, split_slug
from .models import new_id
from .shares import _public

SECRET_LEN = 10
MAX_LINKS = 50
MAX_NAME = 60


def _secret() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(SECRET_LEN))


def share_url(slug: str) -> str:
    return f"{settings().public_url}/b/{slug}"


def _clean_name(name: str) -> str:
    name = " ".join((name or "").split())[:MAX_NAME]
    if not name:
        raise ValueError("Give the link a name: who it's for.")
    return name


def _out(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "name": r["name"], "enabled": bool(r["enabled"]),
        "slug": r["slug"], "url": share_url(r["slug"]), "created_at": r["created_at"],
    }


def _get(conn: sqlite3.Connection, link_id: str) -> sqlite3.Row:
    r = conn.execute("SELECT * FROM book_shares WHERE id = ?", (link_id,)).fetchone()
    if r is None:
        raise NotFound(link_id)
    return r


# --- the household's side -------------------------------------------------------

def listing() -> list[dict]:
    with closing(connect()) as conn:
        rows = conn.execute("SELECT * FROM book_shares ORDER BY rowid").fetchall()
    return [_out(r) for r in rows]


def create(name: str, *, user: str = "") -> dict:
    name = _clean_name(name)
    with write_tx() as conn:
        if conn.execute("SELECT COUNT(*) FROM book_shares").fetchone()[0] >= MAX_LINKS:
            raise ValueError(f"That's {MAX_LINKS} links already; remove one first.")
        link_id = new_id()
        conn.execute(
            "INSERT INTO book_shares (id, name, slug, enabled, created_at, created_by) VALUES (?, ?, ?, 1, ?, ?)",
            (link_id, name, f"{readable(name, fallback='recipes')}-{_secret()}", now_iso(), user),
        )
        return _out(_get(conn, link_id))


def update(link_id: str, *, enabled: bool | None = None, rotate: bool = False, name: str | None = None) -> dict:
    """Switch a link on or off, give it a new secret, or rename it.

    A rename changes only the name the household sees; the words in the link
    stay as they were sent.
    """
    with write_tx() as conn:
        r = _get(conn, link_id)
        head, tail = split_slug(r["slug"])
        if rotate:
            tail = _secret()
        conn.execute(
            "UPDATE book_shares SET slug = ?, enabled = ?, name = ? WHERE id = ?",
            (f"{head}-{tail}", int(r["enabled"] if enabled is None else enabled),
             r["name"] if name is None else _clean_name(name), link_id),
        )
        return _out(_get(conn, link_id))


def remove(link_id: str) -> None:
    with write_tx() as conn:
        _get(conn, link_id)
        conn.execute("DELETE FROM book_shares WHERE id = ?", (link_id,))


# --- what the link opens --------------------------------------------------------

def _open(conn: sqlite3.Connection, slug: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM book_shares WHERE slug = ? AND enabled = 1", (slug,)).fetchone()


def _in_book(doc: dict) -> bool:
    return not doc.get("archived")


def by_slug(slug: str) -> dict | None:
    """The book a link opens, or None if the link is wrong or switched off."""
    with closing(connect()) as conn:
        if _open(conn, slug) is None:
            return None
        rows = conn.execute("SELECT id, doc, updated_at FROM recipes WHERE deleted = 0").fetchall()
    recipes = []
    for r in rows:
        doc = json.loads(r["doc"])
        if _in_book(doc):
            recipes.append({"id": r["id"], "updated_at": r["updated_at"], "doc": _public(doc)})
    recipes.sort(key=lambda x: x["doc"].get("title", "").casefold())
    ids = {x["id"] for x in recipes}
    return {
        "slug": slug,
        "recipes": recipes,
        "categories": categories.get(),
        "photos": {rid: p for rid, p in photos.listing().items() if rid in ids},
    }


def photo(slug: str, recipe_id: str, kind: str, size: str) -> tuple[bytes, str] | None:
    """A photo of a recipe in the book the link opens, or None."""
    with closing(connect()) as conn:
        if _open(conn, slug) is None:
            return None
        r = conn.execute("SELECT doc FROM recipes WHERE id = ? AND deleted = 0", (recipe_id,)).fetchone()
    if r is None or not _in_book(json.loads(r["doc"])):
        return None
    try:
        return photos.read(recipe_id, kind, size)
    except photos.NotFound:
        return None
