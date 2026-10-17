import pytest
from fastapi.testclient import TestClient

from recipie import config, db
from recipie.web import create_app

CURRY = {
    "title": "Chicken curry",
    "ingredients": [
        {"name": "Chicken", "role": "main", "grocy_product_id": 1},
        {"name": "Coconut oil", "role": "minor", "grocy_product_id": 2,
         "substitutes": [{"name": "Ghee", "grocy_product_id": 3}]},
    ],
    "steps": [{"text": "Simmer", "timer_seconds": 1200}],
}

W = {"X-Recipie": "1"}


@pytest.fixture
def client():
    return TestClient(create_app())


def test_push_then_pull_round_trip(client):
    r = client.post("/api/sync", json={"changes": [{"id": "a1", "base_rev": 0, "doc": CURRY}]}, headers=W)
    assert r.json()["results"][0]["status"] == "ok"
    assert r.json()["results"][0]["row"]["rev"] == 1

    pulled = client.get("/api/sync?since=0").json()
    assert [c["id"] for c in pulled["changes"]] == ["a1"]
    assert pulled["changes"][0]["doc"]["steps"][0]["timer_seconds"] == 1200

    # Nothing new after the cursor.
    again = client.get(f"/api/sync?since={pulled['cursor']}").json()
    assert again["changes"] == []


def test_stale_edit_is_a_conflict_and_server_keeps_its_version(client):
    client.post("/api/sync", json={"changes": [{"id": "a1", "base_rev": 0, "doc": CURRY}]}, headers=W)
    db.save({**CURRY, "title": "Claude's edit"}, recipe_id="a1", user="claude")  # rev 2

    r = client.post("/api/sync", json={"changes": [
        {"id": "a1", "base_rev": 1, "doc": {**CURRY, "title": "Phone edit"}}]}, headers=W)
    res = r.json()["results"][0]
    assert res["status"] == "conflict"
    assert res["row"]["doc"]["title"] == "Claude's edit"
    assert db.get("a1")["doc"]["title"] == "Claude's edit"


def test_delete_is_a_tombstone_in_the_feed(client):
    client.post("/api/sync", json={"changes": [{"id": "a1", "base_rev": 0, "doc": CURRY}]}, headers=W)
    cursor = client.get("/api/sync").json()["cursor"]
    client.post("/api/sync", json={"changes": [{"id": "a1", "base_rev": 1, "deleted": True}]}, headers=W)

    feed = client.get(f"/api/sync?since={cursor}").json()["changes"]
    assert feed[0]["id"] == "a1" and feed[0]["deleted"] is True


def test_invalid_recipe_is_reported_not_raised(client):
    r = client.post("/api/sync", json={"changes": [
        {"id": "bad", "base_rev": 0, "doc": {"title": ""}},
        {"id": "good", "base_rev": 0, "doc": CURRY}]}, headers=W)
    assert [x["status"] for x in r.json()["results"]] == ["invalid", "ok"]


def test_cursor_from_the_future_resyncs_from_zero(client):
    client.post("/api/sync", json={"changes": [{"id": "a1", "base_rev": 0, "doc": CURRY}]}, headers=W)
    assert [c["id"] for c in client.get("/api/sync?since=999").json()["changes"]] == ["a1"]


def test_writes_need_the_csrf_header(client):
    r = client.post("/api/sync", json={"changes": []})
    assert r.status_code == 403


def test_api_needs_a_session_without_dev_user(monkeypatch):
    monkeypatch.delenv("RECIPIE_DEV_USER")
    config.settings.cache_clear()
    c = TestClient(create_app())
    assert c.get("/api/sync").status_code == 401
    assert c.get("/api/health").status_code == 200


def test_pantry_snapshot(client):
    snap = client.get("/api/pantry").json()
    assert snap["stock"] == {"1": 500.0, "3": 1.0}
    assert snap["stale"] is False
