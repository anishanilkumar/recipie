"""A recipe's photos: a photo of the plate, and a stand-in found on the web.

Two slots per recipe, shown in this order:

- **own**: a photo of the dish as cooked here. Friday sends the photo taken
  for the food log after cook mode ("Photograph the plate"). The first one
  stays; later ones don't replace it unless the old one is removed.
- **web**: a stand-in until there is an own photo, picked from an image
  search. The search is Openverse (openly licensed images, mostly Flickr and
  Wikimedia Commons), and every pick keeps its credit: title, creator,
  licence and where it came from.

  The apps ask Openverse themselves, from the phone or browser: Openverse sits
  behind a Cloudflare check that turns away requests from data centres, this
  server's included. The app sends the chosen picture's thumbnail and
  Openverse's own record of it; the credit is made here from that record.

Files live in settings().photo_dir as `<recipe>-<kind>-<size>`; the row says
what type each is. A new photo gets a new `v`, which goes into its URL, so a
URL's bytes never change and clients may cache them for good. Like share
links, photos live outside the recipes row and never bump a recipe's rev.
"""

from __future__ import annotations

import json
import os
import re
import time

from .config import settings
from .db import closing, connect, now_iso, write_tx

KINDS = ("own", "web")
SIZES = ("full", "thumb")
MAX_BYTES = 4 * 1024 * 1024
_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_OPENVERSE_ID = re.compile(r"^[0-9a-f-]{36}$")


class NotFound(Exception):
    pass


# --- files --------------------------------------------------------------------

def _path(recipe_id: str, kind: str, size: str) -> str:
    if not _ID.match(recipe_id) or kind not in KINDS or size not in SIZES:
        raise NotFound(recipe_id)
    return os.path.join(settings().photo_dir, f"{recipe_id}-{kind}-{size}")


def _write(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # Written beside the target and renamed, so a reader never sees half a file.
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _drop(recipe_id: str, kind: str) -> None:
    for size in SIZES:
        try:
            os.remove(_path(recipe_id, kind, size))
        except FileNotFoundError:
            pass


def image_type(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _version() -> int:
    return int(time.time() * 1000)


# --- reading ------------------------------------------------------------------

def _entry(r) -> dict:
    out: dict = {"v": r["v"]}
    if r["credit"]:
        out["credit"] = json.loads(r["credit"])
    return out


def listing() -> dict:
    """Every recipe's photos, for the apps' sync: {recipe_id: {"own": {v}, "web": {v, credit}}}."""
    with closing(connect()) as conn:
        rows = conn.execute(
            """SELECT p.* FROM recipe_photos p JOIN recipes r ON r.id = p.recipe_id
               WHERE r.deleted = 0 ORDER BY p.recipe_id"""
        ).fetchall()
    out: dict[str, dict] = {}
    for r in rows:
        out.setdefault(r["recipe_id"], {})[r["kind"]] = _entry(r)
    return out


def of(recipe_id: str) -> dict:
    with closing(connect()) as conn:
        rows = conn.execute("SELECT * FROM recipe_photos WHERE recipe_id = ?", (recipe_id,)).fetchall()
    return {r["kind"]: _entry(r) for r in rows}


def read(recipe_id: str, kind: str, size: str) -> tuple[bytes, str] | None:
    """A photo's bytes and type. A thumb falls back to the full photo."""
    with closing(connect()) as conn:
        r = conn.execute("SELECT * FROM recipe_photos WHERE recipe_id = ? AND kind = ?", (recipe_id, kind)).fetchone()
    if r is None:
        return None
    tries = [("thumb", r["thumb_mime"]), ("full", r["mime"])] if size == "thumb" else [("full", r["mime"])]
    for s, mime in tries:
        if not mime:
            continue
        try:
            with open(_path(recipe_id, kind, s), "rb") as f:
                return f.read(), mime
        except FileNotFoundError:
            continue
    return None


# --- writing ------------------------------------------------------------------

def _require_recipe(conn, recipe_id: str) -> None:
    r = conn.execute("SELECT deleted FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    if r is None or r["deleted"] or not _ID.match(recipe_id):
        raise NotFound(recipe_id)


def put_own(recipe_id: str, data: bytes, *, size: str = "full", keep_existing: bool = False, user: str = "") -> dict:
    """Store a photo of the plate. `full` first; `thumb` (optional) after it.

    With keep_existing, a full photo is stored only when there isn't one yet,
    and the answer says {"kept": true} when the old one stayed.
    """
    mime = image_type(data)
    if mime != "image/jpeg":
        raise ValueError("Photos must be JPEG.")
    if len(data) > MAX_BYTES:
        raise ValueError("Photo is too large.")
    if size not in SIZES:
        raise ValueError("size is full or thumb.")
    with write_tx() as conn:
        _require_recipe(conn, recipe_id)
        current = conn.execute(
            "SELECT * FROM recipe_photos WHERE recipe_id = ? AND kind = 'own'", (recipe_id,)
        ).fetchone()
        if size == "thumb":
            if current is None:
                raise ValueError("Send the full photo before its thumbnail.")
            _write(_path(recipe_id, "own", "thumb"), data)
            conn.execute(
                "UPDATE recipe_photos SET thumb_mime = ? WHERE recipe_id = ? AND kind = 'own'", (mime, recipe_id)
            )
            return {"kept": False}
        if current is not None and keep_existing:
            return {"kept": True}
        _drop(recipe_id, "own")
        _write(_path(recipe_id, "own", "full"), data)
        conn.execute(
            """INSERT INTO recipe_photos (recipe_id, kind, v, mime, thumb_mime, credit, updated_at, updated_by)
               VALUES (?, 'own', ?, ?, '', '', ?, ?)
               ON CONFLICT (recipe_id, kind) DO UPDATE SET v = excluded.v, mime = excluded.mime,
                 thumb_mime = '', credit = '', updated_at = excluded.updated_at, updated_by = excluded.updated_by""",
            (recipe_id, _version(), mime, now_iso(), user),
        )
    return {"kept": False}


def remove(recipe_id: str, kind: str) -> None:
    if kind not in KINDS:
        raise NotFound(kind)
    with write_tx() as conn:
        conn.execute("DELETE FROM recipe_photos WHERE recipe_id = ? AND kind = ?", (recipe_id, kind))
        _drop(recipe_id, kind)


# --- the web stand-in ---------------------------------------------------------

def licence_label(license: str, version: str = "") -> str:
    """Openverse's licence code as people write it: "by-nc-nd", "2.0" -> "CC BY-NC-ND 2.0"."""
    code = (license or "").lower()
    if code == "cc0":
        return "CC0"
    if code in ("pdm", "publicdomain"):
        return "Public domain"
    if not code:
        return ""
    return f"CC {code.upper()} {version}".strip()


def _text(v, limit: int = 300) -> str:
    return str(v or "")[:limit]


def _link(v) -> str:
    u = _text(v, 600)
    return u if u.startswith("https://") or u.startswith("http://") else ""


def credit_from(r: dict) -> dict:
    """The credit, from Openverse's record of the picture (GET /v1/images/<id>/)."""
    return {
        "title": _text(r.get("title")),
        "creator": _text(r.get("creator")),
        "creator_url": _link(r.get("creator_url")),
        "licence": licence_label(_text(r.get("license"), 40), _text(r.get("license_version"), 10)),
        "licence_url": _link(r.get("license_url")),
        "landing_url": _link(r.get("foreign_landing_url")),
        "source": _text(r.get("source"), 60),
        "via": "Openverse",
    }


def set_web(recipe_id: str, openverse_id: str, record: dict, data: bytes, *, user: str = "") -> dict:
    """Use an Openverse picture as the recipe's stand-in.

    [record] is Openverse's own JSON for the picture, which the app read from
    Openverse; [data] the picture's thumbnail. Its licence must be stated.
    """
    if not _OPENVERSE_ID.match(openverse_id or "") or record.get("id") != openverse_id:
        raise ValueError("Not an Openverse picture.")
    credit = credit_from(record)
    if not credit["licence"]:
        raise ValueError("That picture doesn't say its licence.")
    if len(data) > MAX_BYTES:
        raise ValueError("The picture is too large.")
    mime = image_type(data)
    if mime is None:
        raise ValueError("That picture isn't a JPEG, PNG or WebP.")
    with write_tx() as conn:
        _require_recipe(conn, recipe_id)
        _drop(recipe_id, "web")
        _write(_path(recipe_id, "web", "full"), data)
        conn.execute(
            """INSERT INTO recipe_photos (recipe_id, kind, v, mime, thumb_mime, credit, updated_at, updated_by)
               VALUES (?, 'web', ?, ?, '', ?, ?, ?)
               ON CONFLICT (recipe_id, kind) DO UPDATE SET v = excluded.v, mime = excluded.mime,
                 thumb_mime = '', credit = excluded.credit, updated_at = excluded.updated_at,
                 updated_by = excluded.updated_by""",
            (recipe_id, _version(), mime, json.dumps(credit), now_iso(), user),
        )
    return of(recipe_id)
