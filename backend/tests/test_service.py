from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from recipie import db, service
from recipie.web import create_app

CURRY = {"title": "Chicken curry", "ingredients": [], "steps": []}


class FakeVerifier:
    async def verify_token(self, token):
        return SimpleNamespace(client_id="mealplan", subject="x") if token == "good" else None


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(service, "_verifier", FakeVerifier())
    # No dev user: a service is let in by its token alone, not by a session.
    monkeypatch.delenv("RECIPIE_DEV_USER")
    from recipie import config
    config.settings.cache_clear()
    return TestClient(create_app())


def test_a_service_reads_the_feed_with_its_token(client):
    db.save(CURRY, recipe_id="a1")
    r = client.get("/api/service/sync?since=0", headers={"Authorization": "Bearer good"})
    assert r.status_code == 200
    assert [c["id"] for c in r.json()["changes"]] == ["a1"]


def test_a_bad_or_missing_token_is_refused(client):
    assert client.get("/api/service/sync", headers={"Authorization": "Bearer bad"}).status_code == 401
    assert client.get("/api/service/sync").status_code == 401


def test_the_token_opens_nothing_else(client):
    assert client.get("/api/sync", headers={"Authorization": "Bearer good"}).status_code == 401


def test_unconfigured_is_503(monkeypatch):
    monkeypatch.setattr(service, "_verifier", None)
    monkeypatch.delenv("RECIPIE_SERVICE_OIDC_ISSUER", raising=False)
    c = TestClient(create_app())
    assert c.get("/api/service/sync", headers={"Authorization": "Bearer good"}).status_code == 503


def test_saving_and_deleting_announce_a_change(monkeypatch):
    pokes = []
    monkeypatch.setattr(db, "_announcer", SimpleNamespace(poke=lambda: pokes.append(1)))
    db.save(CURRY, recipe_id="a1")
    db.delete("a1")
    assert len(pokes) == 2
