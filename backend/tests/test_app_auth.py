import base64
import hashlib

import pytest
from fastapi.testclient import TestClient

from recipie import auth_web, config, db
from recipie.web import create_app

VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


@pytest.fixture
def client(monkeypatch):
    # Real sessions, not the dev user: these tests are about how one is got.
    monkeypatch.delenv("RECIPIE_DEV_USER")
    config.settings.cache_clear()
    return TestClient(create_app())


def handoff(code="c" * 40):
    db.put_app_handoff(auth_web._hash(code), "anish", CHALLENGE)
    return code


def test_exchange_gives_a_bearer_session(client):
    r = client.post("/auth/app/exchange", json={"code": handoff(), "verifier": VERIFIER})
    assert r.status_code == 200 and r.json()["username"] == "anish"
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers=h).json() == {"username": "anish", "demo": False}
    # Writes over a bearer still need the header a plain form can't send.
    assert client.post("/api/sync", json={"changes": []}, headers=h).status_code == 403
    assert client.post("/api/sync", json={"changes": []}, headers={**h, "X-Recipie": "1"}).status_code == 200


def test_exchange_needs_the_verifier(client):
    code = handoff()
    r = client.post("/auth/app/exchange", json={"code": code, "verifier": "w" * 64})
    assert r.status_code == 403
    # Single use: the wrong guess burned it, so the right one is too late.
    assert client.post("/auth/app/exchange", json={"code": code, "verifier": VERIFIER}).status_code == 403


def test_code_is_single_use(client):
    code = handoff()
    assert client.post("/auth/app/exchange", json={"code": code, "verifier": VERIFIER}).status_code == 200
    assert client.post("/auth/app/exchange", json={"code": code, "verifier": VERIFIER}).status_code == 403


def test_bearer_logout_ends_the_session(client):
    token = client.post("/auth/app/exchange", json={"code": handoff(), "verifier": VERIFIER}).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    client.post("/auth/logout", headers=h, follow_redirects=False)
    assert client.get("/api/me", headers=h).status_code == 401


def test_login_rejects_a_malformed_challenge(client):
    assert client.get("/auth/login?app_challenge=short", follow_redirects=False).status_code == 400
