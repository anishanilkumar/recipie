"""Browser login: OIDC authorization code + PKCE, session kept server-side.

Recipie is a *confidential* client of the identity provider (Kanidm on the
server). The browser only ever holds an opaque, HttpOnly session cookie; the
access and ID tokens never reach JavaScript, so there is nothing for an XSS or
a stray localStorage dump to steal. Sessions last 30 days and slide forward
while in use, which matters for a PWA that may sit unopened for a week and
should still just work in the kitchen.

Who may log in is decided by the identity provider: Kanidm only issues tokens
for this client to members of the group its scope map names.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import secrets
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from . import db
from .config import settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/auth")

COOKIE = "recipie_session"
_discovery: dict | None = None
_jwks: jwt.PyJWKClient | None = None


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _oidc() -> dict:
    global _discovery
    if _discovery is None:
        s = settings()
        if not (s.oidc_issuer and s.oidc_client_id and s.oidc_client_secret):
            raise HTTPException(503, "Login is not configured on this server.")
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(s.oidc_issuer + "/.well-known/openid-configuration")
            r.raise_for_status()
            _discovery = r.json()
    return _discovery


def _callback_url() -> str:
    return settings().public_url + "/auth/callback"


def current_user(request: Request) -> str | None:
    s = settings()
    if s.dev_user:
        return s.dev_user
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    return db.session_user(_hash(token), s.session_days)


@router.get("/login")
async def login():
    meta = await _oidc()
    s = settings()
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    db.put_login_state(state, verifier, nonce)
    query = urlencode({
        "response_type": "code",
        "client_id": s.oidc_client_id,
        "redirect_uri": _callback_url(),
        "scope": "openid profile",
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    return RedirectResponse(f"{meta['authorization_endpoint']}?{query}", status_code=302)


@router.get("/callback")
async def callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error:
        raise HTTPException(403, f"Sign-in was refused: {error}")
    pending = db.pop_login_state(state) if state else None
    if not code or pending is None:
        # Expired (10 min) or replayed. Start over rather than explain.
        return RedirectResponse("/auth/login", status_code=302)

    meta = await _oidc()
    s = settings()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            meta["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": _callback_url(),
                "code_verifier": pending["verifier"],
            },
            auth=(s.oidc_client_id, s.oidc_client_secret),
        )
    if r.status_code != 200:
        log.warning("token exchange failed: %s %s", r.status_code, r.text[:300])
        raise HTTPException(502, "The sign-in server did not accept the login. Try again.")
    claims = await asyncio.to_thread(_verify_id_token, r.json().get("id_token", ""), meta, pending["nonce"])
    username = claims.get("preferred_username") or claims["sub"]

    token = secrets.token_urlsafe(32)
    db.create_session(_hash(token), username, s.session_days)
    log.info("signed in: %s", username)
    resp = RedirectResponse("/", status_code=302)
    resp.set_cookie(
        COOKIE, token,
        max_age=s.session_days * 86400,
        httponly=True,
        secure=s.secure_cookies,
        samesite="lax",
        path="/",
    )
    return resp


def _verify_id_token(id_token: str, meta: dict, nonce: str) -> dict:
    global _jwks
    if _jwks is None:
        _jwks = jwt.PyJWKClient(meta["jwks_uri"], cache_keys=True, lifespan=3600)
    try:
        key = _jwks.get_signing_key_from_jwt(id_token).key
        claims = jwt.decode(
            id_token, key,
            # Pinned, never read from the token header.
            algorithms=["ES256", "RS256"],
            audience=settings().oidc_client_id,
            issuer=meta["issuer"],
            leeway=30,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        log.warning("rejecting id_token: %s", exc)
        raise HTTPException(403, "The sign-in could not be verified. Try again.")
    if not secrets.compare_digest(claims.get("nonce", ""), nonce):
        raise HTTPException(403, "The sign-in could not be verified. Try again.")
    return claims


@router.post("/logout")
async def logout(request: Request):
    token = request.cookies.get(COOKIE)
    if token:
        db.drop_session(_hash(token))
    resp = RedirectResponse("/", status_code=303)
    resp.delete_cookie(COOKIE, path="/")
    return resp
