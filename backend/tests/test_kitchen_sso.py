"""The Kitchen app's one sign-in: a Kanidm ID token traded for a session."""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from recipie import config, kitchen_sso
from recipie.web import create_app

ISSUER = "https://auth.example/oauth2/openid/kitchen-app"
KEY = ec.generate_private_key(ec.SECP256R1())
OTHER = ec.generate_private_key(ec.SECP256R1())


def token(key=KEY, aud="kitchen-app", iss=ISSUER, access=("recipes", "food"), age=5, user="anish"):
    now = time.time()
    claims = {"iss": iss, "aud": aud, "sub": "uuid-1", "preferred_username": user,
              "iat": int(now - age), "exp": int(now - age + 3600)}
    if access is not None:
        claims["kitchen_access"] = access if isinstance(access, str) else list(access)
    return jwt.encode(claims, key, algorithm="ES256")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("RECIPIE_DEV_USER")
    monkeypatch.setenv("RECIPIE_KITCHEN_ISSUER", ISSUER)
    monkeypatch.setenv("RECIPIE_KITCHEN_CLIENT_ID", "kitchen-app")
    monkeypatch.setattr(kitchen_sso, "signing_key", lambda t, i: KEY.public_key())
    config.settings.cache_clear()
    return TestClient(create_app())


def test_a_token_naming_recipes_gives_a_session(client):
    r = client.post("/auth/app/kitchen", json={"id_token": token()})
    assert r.status_code == 200 and r.json()["username"] == "anish"
    me = client.get("/api/me", headers={"Authorization": f"Bearer {r.json()['token']}"})
    assert me.json()["username"] == "anish"


def test_access_is_kanidms_to_give(client):
    r = client.post("/auth/app/kitchen", json={"id_token": token(access=("food",))})
    assert r.status_code == 403
    assert client.post("/auth/app/kitchen", json={"id_token": token(access=None)}).status_code == 403


def test_a_space_separated_claim_counts_too(client):
    assert client.post("/auth/app/kitchen", json={"id_token": token(access="food recipes")}).status_code == 200


@pytest.mark.parametrize("bad", [
    {"key": OTHER},                       # not signed by Kanidm
    {"aud": "recipie-web"},               # issued to another client
    {"iss": "https://evil.example"},      # by another issuer
    {"age": 3600},                        # an old sign-in, replayed
])
def test_tokens_that_are_not_for_us_are_refused(client, bad):
    assert client.post("/auth/app/kitchen", json={"id_token": token(**bad)}).status_code == 401


def test_off_when_not_configured(client, monkeypatch):
    monkeypatch.setenv("RECIPIE_KITCHEN_ISSUER", "")
    config.settings.cache_clear()
    assert client.post("/auth/app/kitchen", json={"id_token": token()}).status_code == 503
