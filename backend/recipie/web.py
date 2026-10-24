"""The HTTP API the PWA talks to.

Everything under /api needs a session, except /api/share/<slug>: an event's
share link, where the link itself is the key.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from . import auth_web, db, events, pantry, shopping
from .config import settings
from .models import DishStatus, EventDoc, RecipeDoc

log = logging.getLogger(__name__)


def require_user(request: Request) -> str:
    user = auth_web.current_user(request)
    if user is None:
        raise HTTPException(401, "Sign in to continue.")
    # Cookies ride along on cross-site form posts. A custom header cannot be
    # set by a plain form, so requiring it on writes closes CSRF without a
    # token dance (SameSite=Lax covers the rest).
    if request.method not in ("GET", "HEAD") and request.headers.get("x-recipie") != "1":
        raise HTTPException(403, "Missing X-Recipie header.")
    return user


class PushChange(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    base_rev: int = Field(ge=0)
    deleted: bool = False
    doc: dict | None = None


class PushBody(BaseModel):
    changes: list[PushChange] = Field(max_length=500)


def _echo(ch: PushChange) -> dict:
    """The demo's answer to a push: accepted, and not stored.

    The visitor's browser keeps the edit as if it had synced, so the app
    behaves normally on their device, but the shared database only ever holds
    the seeded recipes. Nothing a stranger types is shown to anyone else, and
    the demo can't be emptied or defaced.
    """
    if ch.deleted:
        return {"id": ch.id, "status": "ok", "row": None}
    try:
        doc = RecipeDoc.model_validate(ch.doc or {})
    except ValidationError as e:
        return {"id": ch.id, "status": "invalid", "error": e.errors(include_url=False)}
    return {"id": ch.id, "status": "ok", "row": {
        "id": ch.id, "rev": ch.base_rev + 1, "seq": 0, "deleted": False,
        "updated_at": db.now_iso(), "updated_by": "you", "doc": doc.model_dump(),
    }}


# --- events: the household's side ---------------------------------------------

class EventPut(BaseModel):
    base_rev: int = Field(ge=0)
    doc: EventDoc


class ShareBody(BaseModel):
    enabled: bool | None = None
    rotate: bool = False
    name: str | None = Field(default=None, min_length=1, max_length=80)


def _event(event_id: str) -> dict:
    row = events.get(event_id)
    if row is None:
        raise HTTPException(404, "No such event.")
    return row


def _no_demo() -> None:
    # The demo stores nothing a visitor types (see _echo), and an event is
    # only any use if it's stored.
    if settings().demo:
        raise HTTPException(403, "Events can't be saved in the demo.")


def events_router() -> APIRouter:
    r = APIRouter(prefix="/api/events", dependencies=[Depends(require_user)])

    @r.get("")
    def list_events():
        return {"events": [{
            "id": e["id"], "title": e["doc"]["title"], "slug": e["slug"],
            "share_enabled": e["share_enabled"], "updated_at": e["updated_at"],
            "days": [{"label": d["label"], "date": d.get("date", ""), "headcount": d.get("headcount"),
                      "dishes": len(d["dishes"])} for d in e["doc"]["days"]],
        } for e in events.list_live()]}

    @r.post("")
    def create(doc: EventDoc, user: str = Depends(require_user)):
        _no_demo()
        return events.view(events.save(doc, user=user), public=False)

    @r.get("/{event_id}")
    def read(event_id: str):
        return events.view(_event(event_id), public=False)

    @r.put("/{event_id}")
    def update(event_id: str, body: EventPut, user: str = Depends(require_user)):
        _no_demo()
        _event(event_id)
        try:
            row = events.save(body.doc, event_id=event_id, base_rev=body.base_rev, user=user)
        except db.Conflict as c:
            raise HTTPException(409, {"message": "Someone changed this event since you opened it.",
                                      "current": events.view(c.current, public=False)})
        return events.view(row, public=False)

    @r.delete("/{event_id}")
    def remove(event_id: str, user: str = Depends(require_user)):
        _no_demo()
        _event(event_id)
        events.delete(event_id, user=user)
        return {"ok": True}

    @r.post("/{event_id}/share")
    def share(event_id: str, body: ShareBody):
        _no_demo()
        try:
            row = events.set_share(event_id, enabled=body.enabled, rotate=body.rotate, name=body.name)
        except events.NotFound:
            raise HTTPException(404, "No such event.")
        return events.view(row, public=False)

    @r.delete("/{event_id}/notes/{note_id}")
    def remove_note(event_id: str, note_id: str):
        _no_demo()
        try:
            events.delete_note(event_id, note_id)
        except events.NotFound:
            raise HTTPException(404, "No such note.")
        return {"ok": True}

    return r


# --- events: the share link ----------------------------------------------------
#
# No session: the link is the key. Writes still need the X-Recipie header,
# which a plain cross-site form can't send. Nothing here can change the menu
# itself, only tick, add, note and mark dishes done.

By = Field(default="", max_length=40)
# Made by the page, so an item added offline can be ticked before it's sent.
ClientId = Field(default=None, pattern=r"^[A-Za-z0-9_-]{8,64}$")


class CheckBody(BaseModel):
    key: str | None = Field(default=None, max_length=300)
    item_id: str | None = Field(default=None, max_length=64)
    checked: bool
    by: str = By


class ItemBody(BaseModel):
    id: str | None = ClientId
    name: str = Field(min_length=1, max_length=120)
    amount: float | None = Field(default=None, ge=0, le=1_000_000)
    unit: str = Field(default="", max_length=40)
    by: str = By


class NoteBody(BaseModel):
    id: str | None = ClientId
    target: str = Field(default="event", max_length=300, pattern=r"^(event|dish:.+|item:.+)$")
    text: str = Field(min_length=1, max_length=500)
    by: str = By


class DishBody(BaseModel):
    status: DishStatus
    by: str = By


def _shared(request: Request, slug: str) -> dict:
    if request.method not in ("GET", "HEAD") and request.headers.get("x-recipie") != "1":
        raise HTTPException(403, "Missing X-Recipie header.")
    row = events.by_slug(slug)
    if row is None:
        # Same answer for a wrong link and a switched-off one.
        raise HTTPException(404, "This link doesn't open anything. Ask for a new one.")
    return row


def _dish_ids(doc: dict) -> set[str]:
    return {x["id"] for d in doc["days"] for x in d["dishes"]}


def share_router() -> APIRouter:
    r = APIRouter(prefix="/api/share/{slug}")

    @r.get("")
    def read(request: Request, slug: str, since: int = 0):
        row = _shared(request, slug)
        if since and since == row["version"]:
            return {"version": row["version"], "unchanged": True}
        return events.view(row, public=True)

    @r.post("/check")
    def check(request: Request, slug: str, body: CheckBody):
        row = _shared(request, slug)
        try:
            if body.item_id:
                events.check_item(row["id"], body.item_id, body.checked, body.by.strip())
            elif body.key:
                st = events.state(row["id"])
                listing = shopping.build(row["doc"], events.linked_recipes(row["doc"]), dish_status=st["dish_status"])
                if body.key not in {i["key"] for i in listing["items"]}:
                    raise events.NotFound(body.key)
                events.set_check(row["id"], body.key, body.checked, body.by.strip())
            else:
                raise HTTPException(422, "Give key or item_id.")
        except events.NotFound:
            raise HTTPException(404, "That item isn't on the list any more.")
        return {"ok": True}

    @r.post("/items")
    def add_item(request: Request, slug: str, body: ItemBody):
        row = _shared(request, slug)
        try:
            return events.add_item(row["id"], name=body.name.strip(), amount=body.amount,
                                   unit=body.unit.strip(), by=body.by.strip(), item_id=body.id)
        except events.TooMany as e:
            raise HTTPException(409, str(e))

    @r.delete("/items/{item_id}")
    def remove_item(request: Request, slug: str, item_id: str):
        row = _shared(request, slug)
        try:
            events.delete_item(row["id"], item_id)
        except events.NotFound:
            raise HTTPException(404, "That item isn't on the list any more.")
        return {"ok": True}

    @r.post("/notes")
    def add_note(request: Request, slug: str, body: NoteBody):
        row = _shared(request, slug)
        if body.target.startswith("dish:") and body.target[5:] not in _dish_ids(row["doc"]):
            raise HTTPException(404, "That dish isn't on the menu any more.")
        try:
            return events.add_note(row["id"], target=body.target, author=body.by.strip(), text=body.text.strip(), note_id=body.id)
        except events.TooMany as e:
            raise HTTPException(409, str(e))

    @r.post("/dish/{dish_id}")
    def dish(request: Request, slug: str, dish_id: str, body: DishBody):
        row = _shared(request, slug)
        if dish_id not in _dish_ids(row["doc"]):
            raise HTTPException(404, "That dish isn't on the menu any more.")
        events.set_dish_status(row["id"], dish_id, body.status, body.by.strip())
        return {"ok": True}

    return r


def create_app() -> FastAPI:
    db.init()
    app = FastAPI(title="Recipie", docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(auth_web.router)
    app.include_router(events_router())
    app.include_router(share_router())

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.get("/api/me")
    def me(user: str = Depends(require_user)):
        return {"username": user, "demo": settings().demo}

    @app.get("/api/sync")
    def pull(since: int = 0, user: str = Depends(require_user)):
        rows, cursor, more = db.changes_since(max(0, since))
        return {"cursor": cursor, "more": more, "changes": rows}

    @app.post("/api/sync")
    def push(body: PushBody, user: str = Depends(require_user)):
        if settings().demo:
            return {"results": [_echo(ch) for ch in body.changes]}
        results = []
        for ch in body.changes:
            try:
                if ch.deleted:
                    row = db.delete(ch.id, base_rev=ch.base_rev, user=user)
                    if row is None:  # deleting something the server never had
                        results.append({"id": ch.id, "status": "ok", "row": None})
                        continue
                else:
                    row = db.save(RecipeDoc.model_validate(ch.doc or {}), recipe_id=ch.id,
                                  base_rev=ch.base_rev, user=user)
                results.append({"id": ch.id, "status": "ok", "row": row})
            except db.Conflict as c:
                results.append({"id": ch.id, "status": "conflict", "row": c.current})
            except ValidationError as e:
                # One malformed recipe must not wedge the outbox forever.
                results.append({"id": ch.id, "status": "invalid", "error": e.errors(include_url=False)})
        return {"results": results}

    @app.get("/api/pantry")
    def get_pantry(user: str = Depends(require_user)):
        return pantry.snapshot()

    return app
