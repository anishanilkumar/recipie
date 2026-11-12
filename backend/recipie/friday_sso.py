"""One sign-in for Friday, the household Android app.

The app signs in once, with Kanidm, as its own public client (`friday`),
and gets an ID token. It shows that token here, and to the food log and the
inventory, and each issues its own session as if the user had signed in to
it. One password, one browser trip, and the access is still Kanidm's: the
token carries a `friday_access` claim that Kanidm fills from the user's
groups (a claim map on the client), and each server only lets in a token
that names it. Someone with recipes but not the food log gets the Cook tab
and nothing else.

What is checked: Kanidm's signature (keys from the client's discovery
document, algorithm pinned), that the token was issued to the Kitchen app
and by its issuer, that it has not expired and was issued in the last few
minutes (it is traded straight after sign-in, so an old one has no business
here), and the claim. The nonce is the app's to check; it made it.

The same module is in foodlog and grocy_inventory, differing only in the
settings names and the access key.
"""

from __future__ import annotations

import logging
import time

import httpx
import jwt

log = logging.getLogger(__name__)

CLAIM = "friday_access"
# Issued within this long ago. The app trades the token the moment it has it.
MAX_AGE_SECONDS = 600

_keys: dict[str, jwt.PyJWKClient] = {}


class Refused(Exception):
    """The token is fine, but the user may not use this server."""


class Invalid(Exception):
    """Not a token this server accepts."""


def _jwks(issuer: str) -> jwt.PyJWKClient:
    if issuer not in _keys:
        meta = httpx.get(issuer + "/.well-known/openid-configuration", timeout=10).raise_for_status().json()
        _keys[issuer] = jwt.PyJWKClient(meta["jwks_uri"], cache_keys=True, lifespan=3600)
    return _keys[issuer]


def signing_key(id_token: str, issuer: str):
    """Kanidm's key for this token. Replaced in the tests."""
    return _jwks(issuer).get_signing_key_from_jwt(id_token).key


def verify(id_token: str, *, issuer: str, client_id: str, access: str, now: float | None = None) -> str:
    """The user's name, when [id_token] lets them into the server called [access]."""
    now = time.time() if now is None else now
    try:
        claims = jwt.decode(
            id_token, signing_key(id_token, issuer),
            # Pinned, never read from the token header.
            algorithms=["ES256", "RS256"],
            audience=client_id,
            issuer=issuer,
            leeway=30,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except (jwt.PyJWTError, httpx.HTTPError) as exc:
        log.warning("rejecting friday id_token: %s", exc)
        raise Invalid("The sign-in could not be verified. Sign in again.")
    if now - float(claims["iat"]) > MAX_AGE_SECONDS:
        raise Invalid("That sign-in is too old to use. Sign in again.")
    granted = claims.get(CLAIM) or []
    if isinstance(granted, str):
        granted = [v for v in granted.replace(",", " ").split() if v]
    username = claims.get("preferred_username") or claims["sub"]
    if access not in granted:
        log.info("friday sign-in refused for %s: %s not in %s", username, access, granted)
        raise Refused("Your account doesn't have access to this. Ask for it in Kanidm.")
    return username
