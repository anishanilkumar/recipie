"""Settings, read from the environment once at startup.

Nothing secret has a default. On the server the unit sets the public values
and `/etc/recipie.env` supplies the client secret.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    db_path: str
    public_url: str
    # Browser login: Recipie is a confidential OIDC client of the identity
    # provider and keeps the session server-side, so the PWA never holds a
    # token it could leak from localStorage.
    oidc_issuer: str
    oidc_client_id: str
    oidc_client_secret: str
    # Local development only: every request is treated as this user and the
    # login flow is skipped. Refused when the public URL is https.
    dev_user: str
    session_days: int
    pantry_ttl_seconds: int
    # Public demo (recipes-demo): no login, a made-up pantry, and nothing a
    # visitor does is stored. See web.py.
    demo: bool

    @property
    def secure_cookies(self) -> bool:
        return self.public_url.startswith("https://")


@lru_cache(maxsize=1)
def settings() -> Settings:
    s = Settings(
        db_path=os.environ.get("RECIPIE_DB", "recipie.db"),
        public_url=os.environ.get("RECIPIE_PUBLIC_URL", "http://localhost:5173").rstrip("/"),
        oidc_issuer=os.environ.get("RECIPIE_OIDC_ISSUER", "").rstrip("/"),
        oidc_client_id=os.environ.get("RECIPIE_OIDC_CLIENT_ID", ""),
        oidc_client_secret=os.environ.get("RECIPIE_OIDC_CLIENT_SECRET", ""),
        dev_user=os.environ.get("RECIPIE_DEV_USER", ""),
        session_days=int(os.environ.get("RECIPIE_SESSION_DAYS", "30")),
        pantry_ttl_seconds=int(os.environ.get("RECIPIE_PANTRY_TTL", "60")),
        demo=os.environ.get("RECIPIE_DEMO", "") == "1",
    )
    # The demo is public. It must never fall back to the real Grocy.
    if s.demo and not os.environ.get("RECIPIE_PANTRY_FILE"):
        raise RuntimeError("RECIPIE_DEMO needs RECIPIE_PANTRY_FILE: a public demo must not read the real pantry.")
    if s.dev_user and s.secure_cookies:
        raise RuntimeError("RECIPIE_DEV_USER skips login; it cannot be used with an https public URL.")
    return s
