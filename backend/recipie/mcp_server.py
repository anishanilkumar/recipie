"""MCP server: lets Claude read, write and check recipes.

Runs as its own process (its own systemd unit and port) next to the web app,
sharing the SQLite file. Tools write through the same `db` functions the sync
endpoint uses, so a recipe Claude saves reaches every phone on its next sync.
"""

from __future__ import annotations

import argparse
import os

from mcp.server.fastmcp import FastMCP

from . import cookable, db, events, pantry
from .models import EventDoc, RecipeDoc

INSTRUCTIONS = """\
The household recipe book. Recipes saved here show up in the Recipie app on
the user's phone, which works offline in the kitchen.

Only save, change or delete a recipe when the user asks for it. Talking about
a recipe is not an instruction to store it.

When saving, structure it for cooking: one ingredient per line; steps short enough to read from across the counter; a timer_seconds on
any step that waits ("simmer 20 minutes" -> 1200).

Give every ingredient two measures, both shown in the app: its weight in grams
as amount + unit "g", and the measure a cook would use in the kitchen as
alt_amount + alt_unit: tsp, tbsp or cup for spices, pastes, oils and powders;
a count for things you count (eggs: alt_amount 13, alt_unit ""; onions: 9,
"medium"; garlic: 6, "cloves"). Convert carefully with realistic densities
(e.g. turmeric ~3 g/tsp, oil ~14 g/tbsp, fine salt ~6 g/tsp, a medium onion
~150 g) and round to what a spoon can hold (¼, ½, ¾). Skip alt for things
that are only ever weighed, and skip both for "to taste".

Give every step its ingredient_ids: the ingredients that step uses. Cook mode
shows one step at a time with those ingredients' measurements under it, so a
step without them leaves the cook scrolling back to the list. You may give
ingredients short ids of your own ("onions", "oil-masala"), unique within the
recipe, and reference those; when editing, keep the ids get_recipe returned.

Give every ingredient a role. This drives the green/yellow/red badge:
- main: the dish does not exist without it (chicken in chicken curry, rice in
  a biryani). Missing it means the recipe cannot be cooked.
- minor: needed but workable around (coconut oil, curry leaves, an onion).
  One or two missing shows yellow.
- optional: garnish or "if you have it". Never counts.
Add substitutes where a real cook would swap (coconut oil -> ghee, any
neutral oil).

Link ingredients to the pantry so availability can be checked: call
find_pantry_products and put the matches in grocy_product_ids (substitutes
have the same field). The pantry keeps each pack size or variety as its own
product ("White Onions, 2 kg" and "White Onions, 5 kg"; "Potatoes, organic"
and "Potatoes, 5 kg"), so link every product that would do for the
ingredient, in stock or not. Any one in stock counts; linking only one makes
the recipe say "out" whenever the other pack is the one in the cupboard. A
genuinely different thing (red onions for white) is a substitute, not another
link.

Leave salt, water and similar unlinked; unlinked minor ingredients are assumed
to be in the kitchen. Always try to link main ingredients: an unlinked main
ingredient leaves the badge grey ("can't tell").

To change an existing recipe, get_recipe first and send the whole recipe back
with your edits; save_recipe replaces it. Pass the rev you read as
expected_rev so an edit made on the phone in the meantime is not overwritten.

Events are menus cooked for other people, over one or more days, with a
shopping list shared through a link that needs no login (the volunteers
cooking have no accounts). Only create or change one when asked. When given a
pasted menu:
- One Day per day, with its headcount: recipe quantities on the shopping list
  are scaled from the recipe's servings to it. Ask for headcounts if missing.
- Match each dish to the book with list_recipes and set recipe_id. With no
  match, keep the dish as plain text (name + description), and offer to save
  a recipe for it; don't save one unless asked. Typed-in quantities for a
  dish go in extra_ingredients, in event amounts (not scaled).
- "Already made" or bought in -> status "already_made" (adds nothing to the
  list). "Anish, low effort" -> assignee "Anish", effort "low".
- Diet and allergen lines ("All vegetarian", "Contains dairy: pulissery")
  go in dietary_notes, word for word.
The pantry (Grocy) is not used for events: they're cooked in another kitchen.
Give the user the share_url from save_event. To change an event, get_event
first and send the whole event back with expected_rev, keeping the day and
dish ids (ticks and notes hang off them).
"""


def _summary(row: dict, stock) -> dict:
    doc = row["doc"]
    verdict = cookable.assess(doc, stock)
    out = {"id": row["id"], "title": doc["title"], "tags": doc.get("tags", []), "cookable": verdict["status"]}
    for key in ("missing_main", "missing", "swaps", "untracked_main"):
        if verdict[key]:
            out[key] = verdict[key]
    return out


def _find(id_or_title: str) -> dict:
    row = db.get(id_or_title)
    if row:
        return row
    q = id_or_title.casefold().strip()
    rows = db.list_live()
    exact = [r for r in rows if r["doc"]["title"].casefold() == q]
    hits = exact or [r for r in rows if q in r["doc"]["title"].casefold()]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        raise ValueError(f"No recipe matches {id_or_title!r}. Call list_recipes to see what exists.")
    titles = ", ".join(r["doc"]["title"] for r in hits[:10])
    raise ValueError(f"{len(hits)} recipes match {id_or_title!r}: {titles}. Ask which one, then use its id.")


def register(mcp: FastMCP) -> FastMCP:
    @mcp.tool()
    def list_recipes(query: str = "", tag: str = "", cookable_only: bool = False) -> list[dict]:
        """List recipes with whether each can be cooked from the pantry right now.

        cookable: ready (everything there), almost (1-2 minor items missing or a
        main ingredient covered by a substitute), no (a main ingredient missing,
        or 3+ items), unknown (a main ingredient isn't linked to the pantry).
        Filters: query matches title, tags and ingredient names; cookable_only
        keeps ready and almost.
        """
        stock = pantry.stock()
        q, t = query.casefold().strip(), tag.casefold().strip()
        out = []
        for row in db.list_live():
            doc = row["doc"]
            hay = " ".join([doc["title"], *doc.get("tags", []), *(i["name"] for i in doc.get("ingredients", []))]).casefold()
            if q and q not in hay:
                continue
            if t and t not in (x.casefold() for x in doc.get("tags", [])):
                continue
            s = _summary(row, stock)
            if cookable_only and s["cookable"] not in ("ready", "almost"):
                continue
            out.append(s)
        return out

    @mcp.tool()
    def get_recipe(id_or_title: str) -> dict:
        """The full recipe, its rev (pass it back as expected_rev when saving
        an edit), and what is missing from the pantry for it."""
        row = _find(id_or_title)
        return {"id": row["id"], "rev": row["rev"], "updated_at": row["updated_at"],
                "recipe": row["doc"], "pantry_check": cookable.assess(row["doc"], pantry.stock())}

    @mcp.tool()
    def save_recipe(recipe: RecipeDoc, id: str | None = None, expected_rev: int | None = None) -> dict:
        """Create a recipe, or replace an existing one when id is given.

        Only call this when the user has asked to save or change a recipe.
        Replacing sends the whole recipe: anything left out is removed. With
        expected_rev, the save is refused if the recipe changed since it was
        read (e.g. edited on the phone); re-read it and merge.
        """
        if id is not None and db.get(id, include_deleted=True) is None:
            raise ValueError(f"No recipe has id {id!r}. Omit id to create a new one.")
        try:
            row = db.save(recipe, recipe_id=id, base_rev=expected_rev, user="claude")
        except db.Conflict as c:
            raise ValueError(
                f"Not saved: the recipe is at rev {c.current['rev']}, not {expected_rev}. "
                "Someone edited it since you read it. Call get_recipe, merge, and save again."
            ) from None
        return {"id": row["id"], "rev": row["rev"], "title": row["doc"]["title"],
                "pantry_check": cookable.assess(row["doc"], pantry.stock())}

    @mcp.tool()
    def delete_recipe(id: str) -> dict:
        """Delete a recipe. Only when the user asks. It can be restored with restore_recipe."""
        row = db.delete(id, user="claude")
        if row is None:
            raise ValueError(f"No recipe has id {id!r}.")
        return {"deleted": row["id"], "title": row["doc"]["title"]}

    @mcp.tool()
    def restore_recipe(id: str) -> dict:
        """Bring back a deleted recipe."""
        row = db.get(id, include_deleted=True)
        if row is None:
            raise ValueError(f"No recipe has id {id!r}.")
        row = db.save(row["doc"], recipe_id=id, user="claude")
        return {"restored": row["id"], "title": row["doc"]["title"]}

    @mcp.tool()
    def whats_cookable() -> dict:
        """Recipes grouped by whether they can be cooked tonight, with what is missing."""
        stock = pantry.stock()
        groups: dict[str, list] = {"ready": [], "almost": [], "no": [], "unknown": []}
        for row in db.list_live():
            s = _summary(row, stock)
            groups[s.pop("cookable")].append(s)
        snap = pantry.snapshot()
        return {"pantry_checked_at": snap["fetched_at"], "pantry_stale": snap["stale"], **groups}

    @mcp.tool()
    def find_pantry_products(query: str) -> list[dict]:
        """Search Grocy products by name, to link an ingredient (grocy_product_ids).

        Includes products that are out of stock. Link every pack size that
        matches, in stock or not: any one in stock counts, and linking the
        empty ones too is how the badge stays right after the next shop.
        Search the plain word ("onion", "potato") to see every variant.
        """
        return pantry.search(query)

    @mcp.tool()
    def list_events() -> list[dict]:
        """Events (menus for cooking for others), newest first, with their share links."""
        return [{"id": e["id"], "title": e["doc"]["title"],
                 "days": [d["label"] for d in e["doc"]["days"]],
                 "share_url": events.share_url(e) if e["share_enabled"] else None}
                for e in events.list_live()]

    @mcp.tool()
    def get_event(id_or_title: str) -> dict:
        """The full event, its rev (pass it back as expected_rev), share link, and
        shopping list as it stands, with what's been ticked off and the notes."""
        v = events.view(_find_event(id_or_title), public=False)
        v["event"] = v.pop("doc")
        return v

    @mcp.tool()
    def save_event(event: EventDoc, id: str | None = None, expected_rev: int | None = None) -> dict:
        """Create an event, or replace an existing one when id is given.

        Only when the user has asked. Replacing sends the whole event: days or
        dishes left out are removed, and ticks and notes on removed dishes go
        with them. Returns the share link, which opens without a login.
        """
        if id is not None and events.get(id) is None:
            raise ValueError(f"No event has id {id!r}. Omit id to create a new one.")
        unknown = [d.name for day in event.days for d in day.dishes if d.recipe_id and db.get(d.recipe_id) is None]
        if unknown:
            raise ValueError(f"These dishes link recipe ids that aren't in the book: {', '.join(unknown)}. "
                             "Use the id from list_recipes, or leave recipe_id empty.")
        try:
            row = events.save(event, event_id=id, base_rev=expected_rev, user="claude")
        except db.Conflict as c:
            raise ValueError(
                f"Not saved: the event is at rev {c.current.get('rev')}, not {expected_rev}. "
                "Someone edited it since you read it. Call get_event, merge, and save again."
            ) from None
        v = events.view(row, public=False)
        return {"id": row["id"], "rev": row["rev"], "title": row["doc"]["title"],
                "share_url": v["share_url"], "share_enabled": row["share_enabled"],
                "shopping_lines": len([i for i in v["shopping"] if not i["hidden"]]),
                "warnings": v["warnings"]}

    @mcp.tool()
    def share_event(id: str, enabled: bool | None = None, rotate: bool = False) -> dict:
        """Switch an event's share link on or off, or rotate it (the old link stops
        working at once; use when it reached the wrong people). Only when asked."""
        try:
            row = events.set_share(id, enabled=enabled, rotate=rotate)
        except events.NotFound:
            raise ValueError(f"No event has id {id!r}.") from None
        return {"id": row["id"], "share_enabled": row["share_enabled"], "share_url": events.share_url(row)}

    return mcp


def _find_event(id_or_title: str) -> dict:
    row = events.get(id_or_title)
    if row:
        return row
    q = id_or_title.casefold().strip()
    rows = events.list_live()
    exact = [r for r in rows if r["doc"]["title"].casefold() == q]
    hits = exact or [r for r in rows if q in r["doc"]["title"].casefold()]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        raise ValueError(f"No event matches {id_or_title!r}. Call list_events to see what exists.")
    titles = ", ".join(r["doc"]["title"] for r in hits[:10])
    raise ValueError(f"{len(hits)} events match {id_or_title!r}: {titles}. Ask which one, then use its id.")


def build_server(*, host: str, port: int, public_host: str | None, public_url: str | None, auth: bool) -> FastMCP:
    kwargs: dict = {"instructions": INSTRUCTIONS}
    if public_host or auth:
        from mcp.server.transport_security import TransportSecuritySettings

        public_host = public_host or f"{host}:{port}"
        # Same trap as grocy-mcp: switching this on with an empty allow-list
        # rejects everything with 421.
        kwargs["transport_security"] = TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[public_host, f"{host}:{port}", f"localhost:{port}"],
        )
    if auth:
        from grocy_mcp.auth import verifier_from_env
        from mcp.server.auth.settings import AuthSettings

        issuer = os.environ["RECIPIE_MCP_OIDC_ISSUER"].rstrip("/")
        scopes = os.environ.get("RECIPIE_MCP_OIDC_SCOPES", "").split()
        kwargs["token_verifier"] = verifier_from_env("RECIPIE_MCP")
        kwargs["auth"] = AuthSettings(
            issuer_url=issuer,
            # Must equal the connector URL exactly as typed into Claude.
            resource_server_url=public_url or f"https://{public_host}/mcp",
            required_scopes=scopes or None,
        )
    mcp = FastMCP("recipie", host=host, port=port, streamable_http_path="/mcp", stateless_http=True, **kwargs)
    return register(mcp)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="recipie mcp")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8771)
    p.add_argument("--public-host")
    p.add_argument("--public-url")
    p.add_argument("--no-auth", action="store_true", help="local testing only")
    a = p.parse_args(argv)
    db.init()
    build_server(host=a.host, port=a.port, public_host=a.public_host, public_url=a.public_url,
                 auth=not a.no_auth).run(transport="streamable-http")
