"""Read-only access for the household's other services (Mealplan).

A service has no user to sign in. It gets an access token from Kanidm by the
client-credentials grant, as its own OAuth2 client (`mealplan-reader`), and
shows it here as a bearer.

Kanidm's tokens for a confidential client are opaque, not JWTs, so they
can't be checked offline as the MCP server checks Claude's. Recipie asks
Kanidm instead (RFC 7662 introspection), signing in as its own confidential
client (`recipie-web`, the browser login's), and lets in only an active token
issued to a client named in `RECIPIE_SERVICE_CLIENTS`. Each answer is kept
until the token expires (Kanidm's last 15 minutes), so a service syncing
every few minutes costs Kanidm one call per token.

Configured by `RECIPIE_SERVICE_INTROSPECT_URL` and `RECIPIE_SERVICE_CLIENTS`
(space-separated); unset, the service endpoints answer 503.

Everything a service can reach is a GET: `/api/service/sync`, the recipe
feed, in the shape of `/api/sync`. A service never writes a recipe.
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time

import httpx
from fastapi import HTTPException, Request

from .config import settings

log = logging.getLogger(__name__)

_cache: dict[str, tuple[str, float]] = {}
_lock = threading.Lock()


def _config() -> tuple[str, set[str]]:
    url = os.environ.get("RECIPIE_SERVICE_INTROSPECT_URL", "")
    clients = set(os.environ.get("RECIPIE_SERVICE_CLIENTS", "").split())
    if not url or not clients:
        raise HTTPException(503, "Service access is not configured on this server.")
    return url, clients


def introspect(url: str, token: str) -> dict:
    """Kanidm's answer about a token. Replaced in the tests."""
    s = settings()
    r = httpx.post(url, data={"token": token}, auth=(s.oidc_client_id, s.oidc_client_secret), timeout=10)
    r.raise_for_status()
    return r.json()


def check(token: str, now: float | None = None) -> str | None:
    """The calling client's id when the token lets it in, else None."""
    url, clients = _config()
    now = time.time() if now is None else now
    key = hashlib.sha256(token.encode()).hexdigest()
    with _lock:
        hit = _cache.get(key)
        if hit and hit[1] > now:
            return hit[0] or None
    try:
        info = introspect(url, token)
    except httpx.HTTPError as exc:
        log.warning("introspection failed: %s", exc)
        raise HTTPException(503, "Couldn't check the token with the sign-in server.")
    client = info.get("client_id") or ""
    ok = bool(info.get("active")) and client in clients
    if not ok:
        log.info("service token refused: active=%s client=%s", info.get("active"), client or "-")
    exp = float(info.get("exp") or now + 60) if ok else now + 60
    with _lock:
        # Swept here rather than by a timer: the cache holds a token or two.
        for k in [k for k, (_, t) in _cache.items() if t <= now]:
            del _cache[k]
        _cache[key] = (client if ok else "", min(exp, now + 3600))
    return client if ok else None


async def require_service(request: Request) -> str:
    """The calling service's client id, from a valid bearer token."""
    import asyncio

    if request.method not in ("GET", "HEAD"):
        raise HTTPException(405, "Services can only read.")
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        _config()
        raise HTTPException(401, "A bearer token is needed.")
    client = await asyncio.to_thread(check, auth[7:].strip())
    if client is None:
        raise HTTPException(401, "That token was not accepted.")
    return client
