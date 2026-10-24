"""SQLite storage, and the change feed the PWA syncs against.

Two processes share this file: the web app and the MCP server. Every write
runs inside `BEGIN IMMEDIATE`, which takes SQLite's write lock up front, so the
two cannot hand out the same `seq` or both accept an edit against the same
`rev`.

Sync model
----------
* `rev` counts edits to one recipe. A client sends the `rev` its edit was
  based on; if the server has moved on, the edit is a conflict and is not
  applied (the client keeps its version as a copy — see frontend/src/sync.ts).
* `seq` is a global, ever-increasing change number. "Give me everything since
  seq N" is the whole pull protocol, and deletions are rows too (tombstones),
  so a delete reaches a phone that was offline when it happened.
"""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import settings
from .models import RecipeDoc, new_id

SCHEMA = """
CREATE TABLE IF NOT EXISTS recipes (
    id          TEXT PRIMARY KEY,
    rev         INTEGER NOT NULL,
    seq         INTEGER NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL,
    updated_by  TEXT NOT NULL DEFAULT '',
    doc         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recipes_seq ON recipes(seq);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    created_at  REAL NOT NULL,
    expires_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS login_states (
    state       TEXT PRIMARY KEY,
    verifier    TEXT NOT NULL,
    nonce       TEXT NOT NULL,
    created_at  REAL NOT NULL
);

-- Events (events.py). `version` is bumped by every write to the event or to
-- anything hanging off it, so a shared page polls one number.
CREATE TABLE IF NOT EXISTS events (
    id            TEXT PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,
    share_enabled INTEGER NOT NULL DEFAULT 1,
    rev           INTEGER NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    deleted       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    updated_by    TEXT NOT NULL DEFAULT '',
    doc           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_checks (
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    checked     INTEGER NOT NULL,
    by          TEXT NOT NULL DEFAULT '',
    at          TEXT NOT NULL,
    PRIMARY KEY (event_id, key)
);

CREATE TABLE IF NOT EXISTS event_items (
    id          TEXT NOT NULL,
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    amount      REAL,
    unit        TEXT NOT NULL DEFAULT '',
    checked     INTEGER NOT NULL DEFAULT 0,
    checked_by  TEXT NOT NULL DEFAULT '',
    added_by    TEXT NOT NULL DEFAULT '',
    at          TEXT NOT NULL,
    -- Ids can come from the page (events.add_item), so they're only unique per event.
    PRIMARY KEY (event_id, id)
);

CREATE TABLE IF NOT EXISTS event_notes (
    id          TEXT NOT NULL,
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    target      TEXT NOT NULL,
    author      TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL,
    at          TEXT NOT NULL,
    PRIMARY KEY (event_id, id)
);

CREATE TABLE IF NOT EXISTS event_dish_status (
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    dish_id     TEXT NOT NULL,
    status      TEXT NOT NULL,
    by          TEXT NOT NULL DEFAULT '',
    at          TEXT NOT NULL,
    PRIMARY KEY (event_id, dish_id)
);
"""


class Conflict(Exception):
    def __init__(self, current: dict):
        super().__init__("recipe changed since it was read")
        self.current = current


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or settings().db_path, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init(path: str | None = None) -> None:
    with closing(connect(path)) as conn:
        conn.executescript(SCHEMA)
    _migrate_single_product_ids(path)


def _migrate_single_product_ids(path: str | None) -> None:
    """Rewrite recipes still holding one `grocy_product_id` per ingredient.

    Validation already reads the old shape, but phones and Claude see the
    stored document, so it is rewritten once, as a normal edit (rev and seq
    bumped) that every phone picks up on its next sync. Idempotent: a document
    without the old key is left alone, so restarts and the second process
    starting do nothing.
    """
    with write_tx(path) as conn:
        rows = conn.execute(
            "SELECT id, doc FROM recipes WHERE doc LIKE '%\"grocy_product_id\"%'"
        ).fetchall()
        for r in rows:
            doc = RecipeDoc.model_validate_json(r["doc"]).model_dump_json()
            conn.execute(
                "UPDATE recipes SET rev = rev + 1, seq = ?, updated_at = ?, updated_by = 'migration', doc = ? WHERE id = ?",
                (_next_seq(conn), now_iso(), doc, r["id"]),
            )


@contextmanager
def closing(conn: sqlite3.Connection):
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def write_tx(path: str | None = None):
    with closing(connect(path)) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")


def _row(r: sqlite3.Row | None) -> dict | None:
    if r is None:
        return None
    return {
        "id": r["id"],
        "rev": r["rev"],
        "seq": r["seq"],
        "deleted": bool(r["deleted"]),
        "updated_at": r["updated_at"],
        "updated_by": r["updated_by"],
        "doc": json.loads(r["doc"]),
    }


# --- reads -------------------------------------------------------------------

def get(recipe_id: str, *, include_deleted: bool = False) -> dict | None:
    with closing(connect()) as conn:
        r = _row(conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone())
    if r and r["deleted"] and not include_deleted:
        return None
    return r


def list_live() -> list[dict]:
    with closing(connect()) as conn:
        rows = conn.execute("SELECT * FROM recipes WHERE deleted = 0").fetchall()
    out = [_row(r) for r in rows]
    out.sort(key=lambda r: r["doc"]["title"].casefold())
    return out


def changes_since(seq: int, limit: int = 500) -> tuple[list[dict], int, bool]:
    """Rows changed after `seq`, the cursor to resume from, and whether more remain."""
    with closing(connect()) as conn:
        head = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM recipes").fetchone()[0]
        # A cursor ahead of the server means the database was restored from a
        # backup older than the client: start again from the beginning, or
        # that client would never see another change.
        if seq > head:
            seq = 0
        rows = conn.execute(
            "SELECT * FROM recipes WHERE seq > ? ORDER BY seq LIMIT ?", (seq, limit + 1)
        ).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    cursor = rows[-1]["seq"] if more else max(head, seq)
    return [_row(r) for r in rows], cursor, more


# --- writes ------------------------------------------------------------------

def _next_seq(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM recipes").fetchone()[0]


def save(
    doc: RecipeDoc | dict,
    *,
    recipe_id: str | None = None,
    base_rev: int | None = None,
    user: str = "",
) -> dict:
    """Create or replace a recipe.

    `base_rev=None` overwrites unconditionally (used when Claude saves on an
    explicit instruction). Any integer is a compare-and-set: 0 means "this is
    new", anything else must match the stored rev or Conflict is raised.
    """
    if not isinstance(doc, RecipeDoc):
        doc = RecipeDoc.model_validate(doc)
    recipe_id = recipe_id or new_id()
    body = doc.model_dump_json()
    with write_tx() as conn:
        current = _row(conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone())
        current_rev = current["rev"] if current else 0
        if base_rev is not None and base_rev != current_rev:
            raise Conflict(current)
        seq = _next_seq(conn)
        conn.execute(
            """INSERT INTO recipes (id, rev, seq, deleted, updated_at, updated_by, doc)
               VALUES (?, ?, ?, 0, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, seq = excluded.seq,
                 deleted = 0, updated_at = excluded.updated_at,
                 updated_by = excluded.updated_by, doc = excluded.doc""",
            (recipe_id, current_rev + 1, seq, now_iso(), user, body),
        )
        return _row(conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone())


def delete(recipe_id: str, *, base_rev: int | None = None, user: str = "") -> dict | None:
    """Tombstone a recipe. The document is kept so a delete can be undone."""
    with write_tx() as conn:
        current = _row(conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone())
        if current is None:
            return None
        if base_rev is not None and base_rev != current["rev"]:
            raise Conflict(current)
        if current["deleted"]:
            return current
        conn.execute(
            "UPDATE recipes SET rev = rev + 1, seq = ?, deleted = 1, updated_at = ?, updated_by = ? WHERE id = ?",
            (_next_seq(conn), now_iso(), user, recipe_id),
        )
        return _row(conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone())


# --- sessions ----------------------------------------------------------------

def put_login_state(state: str, verifier: str, nonce: str) -> None:
    with write_tx() as conn:
        # Abandoned logins are swept here rather than by a timer.
        conn.execute("DELETE FROM login_states WHERE created_at < ?", (time.time() - 600,))
        conn.execute(
            "INSERT INTO login_states (state, verifier, nonce, created_at) VALUES (?, ?, ?, ?)",
            (state, verifier, nonce, time.time()),
        )


def pop_login_state(state: str) -> dict | None:
    with write_tx() as conn:
        r = conn.execute(
            "SELECT * FROM login_states WHERE state = ? AND created_at >= ?",
            (state, time.time() - 600),
        ).fetchone()
        conn.execute("DELETE FROM login_states WHERE state = ?", (state,))
    return dict(r) if r else None


def create_session(token_hash: str, username: str, days: int) -> None:
    now = time.time()
    with write_tx() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        conn.execute(
            "INSERT INTO sessions (token_hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token_hash, username, now, now + days * 86400),
        )


def session_user(token_hash: str, days: int) -> str | None:
    """Look a session up, sliding its expiry forward at most once a day."""
    now = time.time()
    with closing(connect()) as conn:
        r = conn.execute(
            "SELECT username, expires_at FROM sessions WHERE token_hash = ?", (token_hash,)
        ).fetchone()
        if r is None or r["expires_at"] < now:
            return None
        if r["expires_at"] < now + (days - 1) * 86400:
            conn.execute(
                "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
                (now + days * 86400, token_hash),
            )
        return r["username"]


def drop_session(token_hash: str) -> None:
    with write_tx() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
