"""Event menus, and what people with the share link do to them.

The menu itself (EventDoc) is edited by the household, with the same rev
compare-and-set as a recipe. Everything a visitor with the link does is kept
in side tables: a tick, an added item, a note, a dish marked done. Those never
touch the menu's rev, so a volunteer ticking rice off in the shop can't make
an edit on the phone conflict.

The share link is /e/<readable>-<secret>: the readable part is the title, the
six-character secret is what keeps a stranger from guessing it. Rotating the
link changes only the secret; the old link stops working at once.
"""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
import unicodedata

from . import db, shopping
from .config import settings
from .db import Conflict, closing, connect, now_iso, write_tx
from .models import EventDoc, new_id

# No 0/o, 1/l/i: the link may be read out loud or copied by hand.
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
SECRET_LEN = 6

MAX_ITEMS = 300
MAX_NOTES = 1000


class NotFound(Exception):
    pass


class TooMany(Exception):
    pass


def readable(title: str) -> str:
    s = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:48].rstrip("-") or "event"


def _secret() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(SECRET_LEN))


def split_slug(slug: str) -> tuple[str, str]:
    head, _, tail = slug.rpartition("-")
    return head, tail


def _row(r: sqlite3.Row | None) -> dict | None:
    if r is None:
        return None
    return {
        "id": r["id"],
        "slug": r["slug"],
        "share_enabled": bool(r["share_enabled"]),
        "rev": r["rev"],
        "version": r["version"],
        "deleted": bool(r["deleted"]),
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
        "updated_by": r["updated_by"],
        "doc": json.loads(r["doc"]),
    }


def _get(conn: sqlite3.Connection, event_id: str) -> dict | None:
    return _row(conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone())


def _bump(conn: sqlite3.Connection, event_id: str) -> None:
    conn.execute("UPDATE events SET version = version + 1 WHERE id = ?", (event_id,))


# --- the menu (household only) -----------------------------------------------

def get(event_id: str) -> dict | None:
    with closing(connect()) as conn:
        r = _get(conn, event_id)
    return r if r and not r["deleted"] else None


def list_live() -> list[dict]:
    with closing(connect()) as conn:
        rows = conn.execute("SELECT * FROM events WHERE deleted = 0 ORDER BY created_at DESC").fetchall()
    return [_row(r) for r in rows]


def by_slug(slug: str) -> dict | None:
    """The event a share link opens, or None if the link is wrong or switched off."""
    with closing(connect()) as conn:
        r = _row(conn.execute("SELECT * FROM events WHERE slug = ?", (slug,)).fetchone())
    if r is None or r["deleted"] or not r["share_enabled"]:
        return None
    return r


def save(doc: EventDoc | dict, *, event_id: str | None = None, base_rev: int | None = None, user: str = "") -> dict:
    """Create or replace an event's menu. Same rev rules as db.save."""
    if not isinstance(doc, EventDoc):
        doc = EventDoc.model_validate(doc)
    body = doc.model_dump_json()
    now = now_iso()
    with write_tx() as conn:
        current = _get(conn, event_id) if event_id else None
        if current is None or current["deleted"]:
            if base_rev not in (None, 0):
                raise Conflict(current or {})
            event_id = event_id or new_id()
            if current is None:
                conn.execute(
                    """INSERT INTO events (id, slug, rev, created_at, updated_at, updated_by, doc)
                       VALUES (?, ?, 1, ?, ?, ?, ?)""",
                    (event_id, f"{readable(doc.title)}-{_secret()}", now, now, user, body),
                )
            else:
                conn.execute(
                    "UPDATE events SET deleted = 0, rev = rev + 1, version = version + 1, updated_at = ?, updated_by = ?, doc = ? WHERE id = ?",
                    (now, user, body, event_id),
                )
            return _get(conn, event_id)
        if base_rev is not None and base_rev != current["rev"]:
            raise Conflict(current)
        # A status the household changed in the menu takes over from whatever
        # a visitor last set for that dish.
        before = {x["id"]: x.get("status") for d in current["doc"]["days"] for x in d["dishes"]}
        for day in doc.days:
            for dish in day.dishes:
                if dish.id in before and before[dish.id] != dish.status:
                    conn.execute("DELETE FROM event_dish_status WHERE event_id = ? AND dish_id = ?", (event_id, dish.id))
        conn.execute(
            "UPDATE events SET rev = rev + 1, version = version + 1, updated_at = ?, updated_by = ?, doc = ? WHERE id = ?",
            (now, user, body, event_id),
        )
        return _get(conn, event_id)


def delete(event_id: str, *, user: str = "") -> dict | None:
    with write_tx() as conn:
        current = _get(conn, event_id)
        if current is None:
            return None
        conn.execute(
            "UPDATE events SET deleted = 1, rev = rev + 1, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?",
            (now_iso(), user, event_id),
        )
        return _get(conn, event_id)


def set_share(event_id: str, *, enabled: bool | None = None, rotate: bool = False, name: str | None = None) -> dict:
    """Switch the link on or off, give it a new secret, or rename its readable part."""
    with write_tx() as conn:
        current = _get(conn, event_id)
        if current is None or current["deleted"]:
            raise NotFound(event_id)
        head, tail = split_slug(current["slug"])
        if name is not None:
            head = readable(name)
        if rotate:
            tail = _secret()
        conn.execute(
            "UPDATE events SET slug = ?, share_enabled = ?, version = version + 1 WHERE id = ?",
            (f"{head}-{tail}", int(current["share_enabled"] if enabled is None else enabled), event_id),
        )
        return _get(conn, event_id)


# --- what visitors do ---------------------------------------------------------

def state(event_id: str) -> dict:
    """Ticks, added items, notes and dish statuses for one event."""
    with closing(connect()) as conn:
        checks = conn.execute("SELECT key, checked, by, at FROM event_checks WHERE event_id = ?", (event_id,)).fetchall()
        items = conn.execute(
            "SELECT id, name, amount, unit, checked, checked_by, added_by, at FROM event_items WHERE event_id = ? ORDER BY rowid",
            (event_id,),
        ).fetchall()
        notes = conn.execute(
            "SELECT id, target, author, text, at FROM event_notes WHERE event_id = ? ORDER BY rowid", (event_id,)
        ).fetchall()
        statuses = conn.execute(
            "SELECT dish_id, status, by, at FROM event_dish_status WHERE event_id = ?", (event_id,)
        ).fetchall()
    return {
        "checks": {r["key"]: {"checked": bool(r["checked"]), "by": r["by"], "at": r["at"]} for r in checks},
        "items": [{**dict(r), "checked": bool(r["checked"])} for r in items],
        "notes": [dict(r) for r in notes],
        "dish_status": {r["dish_id"]: {"status": r["status"], "by": r["by"], "at": r["at"]} for r in statuses},
    }


def set_check(event_id: str, key: str, checked: bool, by: str) -> None:
    with write_tx() as conn:
        conn.execute(
            """INSERT INTO event_checks (event_id, key, checked, by, at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(event_id, key) DO UPDATE SET checked = excluded.checked, by = excluded.by, at = excluded.at""",
            (event_id, key, int(checked), by, now_iso()),
        )
        _bump(conn, event_id)


def add_item(event_id: str, *, name: str, amount: float | None, unit: str, by: str, item_id: str | None = None) -> dict:
    """Add an item to the list. The id may come from the page, which made it
    while offline; sending the same one twice (a retry) adds it once."""
    item = {"id": item_id or new_id(), "name": name, "amount": amount, "unit": unit,
            "checked": False, "checked_by": "", "added_by": by, "at": now_iso()}
    with write_tx() as conn:
        if conn.execute("SELECT 1 FROM event_items WHERE id = ? AND event_id = ?", (item["id"], event_id)).fetchone():
            return item
        n = conn.execute("SELECT COUNT(*) FROM event_items WHERE event_id = ?", (event_id,)).fetchone()[0]
        if n >= MAX_ITEMS:
            raise TooMany(f"The list already has {MAX_ITEMS} added items.")
        conn.execute(
            "INSERT INTO event_items (id, event_id, name, amount, unit, added_by, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (item["id"], event_id, name, amount, unit, by, item["at"]),
        )
        _bump(conn, event_id)
    return item


def check_item(event_id: str, item_id: str, checked: bool, by: str) -> None:
    with write_tx() as conn:
        cur = conn.execute(
            "UPDATE event_items SET checked = ?, checked_by = ? WHERE id = ? AND event_id = ?",
            (int(checked), by, item_id, event_id),
        )
        if cur.rowcount == 0:
            raise NotFound(item_id)
        _bump(conn, event_id)


def delete_item(event_id: str, item_id: str) -> None:
    with write_tx() as conn:
        cur = conn.execute("DELETE FROM event_items WHERE id = ? AND event_id = ?", (item_id, event_id))
        if cur.rowcount == 0:
            raise NotFound(item_id)
        _bump(conn, event_id)


def add_note(event_id: str, *, target: str, author: str, text: str, note_id: str | None = None) -> dict:
    """Same retry rule as add_item."""
    note = {"id": note_id or new_id(), "target": target, "author": author, "text": text, "at": now_iso()}
    with write_tx() as conn:
        if conn.execute("SELECT 1 FROM event_notes WHERE id = ? AND event_id = ?", (note["id"], event_id)).fetchone():
            return note
        n = conn.execute("SELECT COUNT(*) FROM event_notes WHERE event_id = ?", (event_id,)).fetchone()[0]
        if n >= MAX_NOTES:
            raise TooMany(f"This event already has {MAX_NOTES} notes.")
        conn.execute(
            "INSERT INTO event_notes (id, event_id, target, author, text, at) VALUES (?, ?, ?, ?, ?, ?)",
            (note["id"], event_id, target, author, text, note["at"]),
        )
        _bump(conn, event_id)
    return note


def delete_note(event_id: str, note_id: str) -> None:
    with write_tx() as conn:
        cur = conn.execute("DELETE FROM event_notes WHERE id = ? AND event_id = ?", (note_id, event_id))
        if cur.rowcount == 0:
            raise NotFound(note_id)
        _bump(conn, event_id)


def set_dish_status(event_id: str, dish_id: str, status: str, by: str) -> None:
    with write_tx() as conn:
        conn.execute(
            """INSERT INTO event_dish_status (event_id, dish_id, status, by, at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(event_id, dish_id) DO UPDATE SET status = excluded.status, by = excluded.by, at = excluded.at""",
            (event_id, dish_id, status, by, now_iso()),
        )
        _bump(conn, event_id)


# --- what the pages see -------------------------------------------------------

def share_url(row: dict) -> str:
    return f"{settings().public_url}/e/{row['slug']}"


def linked_recipes(doc: dict) -> dict[str, dict]:
    out = {}
    for day in doc.get("days", []):
        for dish in day.get("dishes", []):
            rid = dish.get("recipe_id")
            if rid and rid not in out:
                r = db.get(rid)
                if r:
                    out[rid] = r["doc"]
    return out


def view(row: dict, *, public: bool) -> dict:
    """Everything a page needs to show one event.

    The shared page gets the linked recipes too (it has no recipe book of its
    own) and no hidden rows; the household's editor gets the event's id, rev
    and share settings.
    """
    doc = row["doc"]
    recipes = linked_recipes(doc)
    st = state(row["id"])
    listing = shopping.build(doc, recipes, dish_status=st["dish_status"], checks=st["checks"])
    out = {
        "version": row["version"],
        "doc": doc,
        "shopping": [i for i in listing["items"] if not (public and i["hidden"])],
        "warnings": listing["warnings"],
        "items": st["items"],
        "notes": st["notes"],
        "dish_status": st["dish_status"],
    }
    if public:
        out["slug"] = row["slug"]
        out["recipes"] = recipes
    else:
        out.update({
            "id": row["id"], "rev": row["rev"], "slug": row["slug"],
            "share_enabled": row["share_enabled"], "share_url": share_url(row),
            "updated_at": row["updated_at"], "updated_by": row["updated_by"],
        })
    return out
