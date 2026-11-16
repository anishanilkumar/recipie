"""Read-only access for the household's other services (Mealplan).

A service has no user to sign in. It gets an access token from Kanidm by the
client-credentials grant, as its own OAuth2 client (a service account), and
shows it here as a bearer. The token is checked offline against Kanidm's
keys with the same verifier the MCP server uses (grocy-mcp's), configured by
`RECIPIE_SERVICE_OIDC_ISSUER` / `_JWKS_URI` / `_AUDIENCE` / `_SCOPES`. Unset:
the service endpoints answer 503.

Everything a service can reach is a GET: `/api/service/sync`, the recipe
feed, in the shape of `/api/sync`. A service never writes a recipe.
"""

from __future__ import annotations

import logging
import os

from fastapi import HTTPException, Request

log = logging.getLogger(__name__)

PREFIX = "RECIPIE_SERVICE"
_verifier = None


def _get_verifier():
    global _verifier
    if _verifier is None:
        if not os.environ.get(f"{PREFIX}_OIDC_ISSUER"):
            raise HTTPException(503, "Service access is not configured on this server.")
        from grocy_mcp.auth import verifier_from_env

        _verifier = verifier_from_env(PREFIX)
    return _verifier


async def require_service(request: Request) -> str:
    """The calling service's name, from a valid bearer token."""
    if request.method not in ("GET", "HEAD"):
        raise HTTPException(405, "Services can only read.")
    verifier = _get_verifier()
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "A bearer token is needed.")
    token = await verifier.verify_token(auth[7:].strip())
    if token is None:
        raise HTTPException(401, "That token was not accepted.")
    return token.client_id or token.subject or "service"
