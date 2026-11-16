"""A recipe's photos: a photo of the plate, and a stand-in found on the web.

Two slots per recipe, shown in this order:

- **own**: a photo of the dish as cooked here. Friday sends the photo taken
  for the food log after cook mode ("Photograph the plate"). The first one
  stays; later ones don't replace it unless the old one is removed.
- **web**: a stand-in until there is an own photo, picked from an image
  search. The search is Openverse (openly licensed images, mostly Flickr and
  Wikimedia Commons), and every pick keeps its credit: title, creator,
  licence and where it came from. The credit is read from Openverse by the
  server when the picture is chosen, never taken from the client.

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
from urllib.parse import quote

import httpx

from .config import settings
from .db import closing, connect, now_iso, write_tx

KINDS = ("own", "web")
SIZES = ("full", "thumb")
MAX_BYTES = 4 * 1024 * 1024
OPENVERSE = "https://api.openverse.org/v1"
# Openverse asks API users to say who they are; this names the app, not the household.
USER_AGENT = "Recipie/0.1 (self-hosted recipe book; +https://github.com/anishanilkumar/recipie)"
_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_OPENVERSE_ID = re.compile(r"^[0-9a-f-]{36}$")


class NotFound(Exception):
    pass


class Unavailable(Exception):
    """The image search didn't answer, or sent something unusable."""


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

def _client() -> httpx.Client:
    return httpx.Client(timeout=15, headers={"User-Agent": USER_AGENT}, follow_redirects=True)


def _get_json(url: str) -> dict:
    try:
        with _client() as c:
            res = c.get(url)
    except httpx.HTTPError as e:
        raise Unavailable(str(e)) from e
    if res.status_code == 404:
        raise NotFound(url)
    if res.status_code == 429:
        raise Unavailable("The image search is busy. Try again in a minute.")
    if res.status_code >= 400:
        raise Unavailable(f"The image search said {res.status_code}.")
    return res.json()


def _get_bytes(url: str) -> bytes:
    try:
        with _client() as c:
            res = c.get(url)
    except httpx.HTTPError as e:
        raise Unavailable(str(e)) from e
    if res.status_code >= 400:
        raise Unavailable(f"The picture didn't download ({res.status_code}).")
    if len(res.content) > MAX_BYTES:
        raise Unavailable("The picture is too large.")
    return res.content


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


def _credit(r: dict) -> dict:
    return {
        "title": r.get("title") or "",
        "creator": r.get("creator") or "",
        "creator_url": r.get("creator_url") or "",
        "licence": licence_label(r.get("license", ""), r.get("license_version") or ""),
        "licence_url": r.get("license_url") or "",
        "landing_url": r.get("foreign_landing_url") or "",
        "source": r.get("source") or "",
        "via": "Openverse",
    }


def search_terms(title: str) -> list[str]:
    """What to search for a recipe's title, most specific first.

    "Kerala Egg Puffs (24)" -> ["kerala egg puffs", "egg puffs", "puffs"]: the
    serving count goes, then words come off the front until something answers.
    """
    t = re.sub(r"\(.*?\)", " ", title.lower())
    t = re.sub(r"[^\w\s'-]", " ", t)
    words = [w for w in t.split() if not w.isdigit() and w not in ("for", "with", "and", "the", "a", "of")]
    terms = [" ".join(words[i:]) for i in range(len(words)) if len(words) - i >= 1]
    return terms[:3] or [title.strip().lower()]


def search(query: str, *, limit: int = 18) -> dict:
    """Pictures for a query, with what the credit will say. Asks Openverse."""
    q = query.strip()[:200]
    if not q:
        return {"query": q, "results": []}
    data = _get_json(f"{OPENVERSE}/images/?q={quote(q)}&page_size={limit}&mature=false")
    results = []
    for r in data.get("results", []):
        if not _OPENVERSE_ID.match(str(r.get("id", ""))):
            continue
        results.append({
            "id": r["id"],
            "thumb": f"{OPENVERSE}/images/{r['id']}/thumb/",
            "width": r.get("width"),
            "height": r.get("height"),
            "credit": _credit(r),
        })
    return {"query": q, "results": results}


def search_for_recipe(title: str, query: str | None = None) -> dict:
    """The search for a recipe: the person's own words, or the title, shortened until it finds something."""
    if query and query.strip():
        return search(query)
    last = {"query": "", "results": []}
    for term in search_terms(title):
        last = search(term)
        if len(last["results"]) >= 4:
            return last
    return last


def set_web(recipe_id: str, openverse_id: str, *, user: str = "") -> dict:
    """Use an Openverse picture as the recipe's stand-in. The credit is read from Openverse here."""
    if not _OPENVERSE_ID.match(openverse_id or ""):
        raise ValueError("Not an Openverse picture.")
    with closing(connect()) as conn:
        _require_recipe(conn, recipe_id)
    detail = _get_json(f"{OPENVERSE}/images/{openverse_id}/")
    data = _get_bytes(f"{OPENVERSE}/images/{openverse_id}/thumb/")
    mime = image_type(data)
    if mime is None:
        raise Unavailable("That picture isn't a JPEG, PNG or WebP.")
    credit = _credit(detail)
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
