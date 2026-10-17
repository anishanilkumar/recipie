"""The HTTP API the PWA talks to. Everything under /api needs a session."""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from . import auth_web, db, pantry
from .models import RecipeDoc

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


def create_app() -> FastAPI:
    db.init()
    app = FastAPI(title="Recipie", docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(auth_web.router)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.get("/api/me")
    def me(user: str = Depends(require_user)):
        return {"username": user}

    @app.get("/api/sync")
    def pull(since: int = 0, user: str = Depends(require_user)):
        rows, cursor, more = db.changes_since(max(0, since))
        return {"cursor": cursor, "more": more, "changes": rows}

    @app.post("/api/sync")
    def push(body: PushBody, user: str = Depends(require_user)):
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
