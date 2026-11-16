from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from recipie import config, db, service
from recipie.web import create_app

CURRY = {"title": "Chicken curry", "ingredients": [], "steps": []}

TOKENS = {
    "good": {"active": True, "client_id": "mealplan-reader", "exp": 4_000_000_000},
    "other": {"active": True, "client_id": "someone-else", "exp": 4_000_000_000},
    "expired": {"active": False},
}


@pytest.fixture
def asked(monkeypatch):
    calls = []

    def introspect(url, token):
        calls.append(token)
        return TOKENS.get(token, {"active": False})
    monkeypatch.setattr(service, "introspect", introspect)
    monkeypatch.setattr(service, "_cache", {})
    monkeypatch.setenv("RECIPIE_SERVICE_INTROSPECT_URL", "https://auth.example/oauth2/token/introspect")
    monkeypatch.setenv("RECIPIE_SERVICE_CLIENTS", "mealplan-reader")
    return calls


@pytest.fixture
def client(asked, monkeypatch):
    # No dev user: a service is let in by its token alone, not by a session.
    monkeypatch.delenv("RECIPIE_DEV_USER")
    config.settings.cache_clear()
    return TestClient(create_app())


def get(client, token):
    return client.get("/api/service/sync?since=0", headers={"Authorization": f"Bearer {token}"})


def test_a_service_reads_the_feed_with_its_token(client):
    db.save(CURRY, recipe_id="a1")
    r = get(client, "good")
    assert r.status_code == 200
    assert [c["id"] for c in r.json()["changes"]] == ["a1"]


def test_inactive_unknown_or_other_clients_are_refused(client):
    assert get(client, "expired").status_code == 401
    assert get(client, "other").status_code == 401
    assert client.get("/api/service/sync").status_code == 401


def test_kanidm_is_asked_once_per_token(client, asked):
    get(client, "good")
    get(client, "good")
    get(client, "other")
    get(client, "other")
    assert asked == ["good", "other"]


def test_the_token_opens_nothing_else(client):
    assert client.get("/api/sync", headers={"Authorization": "Bearer good"}).status_code == 401


def test_unconfigured_is_503(monkeypatch):
    monkeypatch.delenv("RECIPIE_SERVICE_INTROSPECT_URL", raising=False)
    c = TestClient(create_app())
    assert c.get("/api/service/sync", headers={"Authorization": "Bearer good"}).status_code == 503


def test_saving_and_deleting_announce_a_change(monkeypatch):
    pokes = []
    monkeypatch.setattr(db, "_announcer", SimpleNamespace(poke=lambda: pokes.append(1)))
    db.save(CURRY, recipe_id="a1")
    db.delete("a1")
    assert len(pokes) == 2
