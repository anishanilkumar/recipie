import pytest
from fastapi.testclient import TestClient

from recipie import config, db, events
from recipie.web import create_app

W = {"X-Recipie": "1"}

RICE = {"title": "Rice", "servings": 4, "ingredients": [{"id": "rice", "name": "Rice", "amount": 300, "unit": "g", "role": "main"}]}


def menu(rice_id):
    return {"title": "Lunch Menu – Migrant Kitchen", "dietary_notes": "All vegetarian, mild spice.", "days": [
        {"id": "d1", "label": "Day 1", "headcount": 40, "dishes": [
            {"id": "rice", "name": "Rice", "recipe_id": rice_id},
            {"id": "inji", "name": "Inji curry", "status": "already_made"},
            {"id": "puffs", "name": "Egg puffs", "assignee": "Anish", "effort": "low"},
        ]},
    ]}


@pytest.fixture
def client():
    return TestClient(create_app())


@pytest.fixture
def made(client):
    rice = db.save(RICE)
    return client.post("/api/events", json=menu(rice["id"]), headers=W).json()


@pytest.fixture
def anon(made, monkeypatch):
    """A visitor with the link and no session (after the household made the event)."""
    monkeypatch.delenv("RECIPIE_DEV_USER")
    config.settings.cache_clear()
    return TestClient(create_app())


def test_create_gives_a_readable_link_with_a_secret(made):
    head, secret = events.split_slug(made["slug"])
    assert head == "lunch-menu-migrant-kitchen" and len(secret) == events.SECRET_LEN
    assert made["share_url"].endswith(f"/e/{made['slug']}")
    assert made["shopping"][0]["amount"] == 3000  # 300 g × 40/4


def test_owner_edit_with_stale_rev_is_a_conflict(client, made):
    doc = {**made["doc"], "title": "Renamed"}
    ok = client.put(f"/api/events/{made['id']}", json={"base_rev": 1, "doc": doc}, headers=W)
    assert ok.status_code == 200 and ok.json()["rev"] == 2
    # The link is not renamed with the title: links already sent keep working.
    assert ok.json()["slug"] == made["slug"]
    stale = client.put(f"/api/events/{made['id']}", json={"base_rev": 1, "doc": doc}, headers=W)
    assert stale.status_code == 409


def test_owner_endpoints_need_a_session(anon, made):
    assert anon.get("/api/events").status_code == 401
    assert anon.get(f"/api/events/{made['id']}").status_code == 401


def test_link_opens_without_login_and_hides_owner_fields(anon, made):
    r = anon.get(f"/api/share/{made['slug']}")
    assert r.status_code == 200
    v = r.json()
    assert "id" not in v and "rev" not in v
    assert v["doc"]["days"][0]["dishes"][2]["assignee"] == "Anish"
    assert list(v["recipes"].values())[0]["title"] == "Rice"


def test_visitors_tick_add_note_and_mark_done(anon, made):
    base = f"/api/share/{made['slug']}"
    v0 = anon.get(base).json()["version"]
    key = anon.get(base).json()["shopping"][0]["key"]

    assert anon.post(f"{base}/check", json={"key": key, "checked": True, "by": "Priya"}, headers=W).status_code == 200
    item = anon.post(f"{base}/items", json={"name": "Oat milk", "amount": 2, "unit": "l", "by": "Priya"}, headers=W).json()
    anon.post(f"{base}/check", json={"item_id": item["id"], "checked": True, "by": "Sam"}, headers=W)
    anon.post(f"{base}/notes", json={"target": "dish:puffs", "text": "Pastry is in the freezer", "by": "Anish"}, headers=W)
    anon.post(f"{base}/notes", json={"text": "Doors open at 12", "by": "Anish"}, headers=W)
    anon.post(f"{base}/dish/puffs", json={"status": "done", "by": "Anish"}, headers=W)

    v = anon.get(base).json()
    assert v["version"] > v0
    assert v["shopping"][0]["checked"] and v["shopping"][0]["checked_by"] == "Priya"
    assert v["items"][0]["checked"] and v["items"][0]["checked_by"] == "Sam"
    assert [n["target"] for n in v["notes"]] == ["dish:puffs", "event"]
    assert v["dish_status"]["puffs"]["status"] == "done"
    # Polling with the current version is cheap.
    assert anon.get(f"{base}?since={v['version']}").json() == {"version": v["version"], "unchanged": True}


def test_visitor_ticks_dont_touch_the_menu_rev(client, made):
    base = f"/api/share/{made['slug']}"
    key = made["shopping"][0]["key"]
    client.post(f"{base}/check", json={"key": key, "checked": True}, headers=W)
    # The household's edit, based on rev 1, still goes through.
    r = client.put(f"/api/events/{made['id']}", json={"base_rev": 1, "doc": made["doc"]}, headers=W)
    assert r.status_code == 200
    assert r.json()["shopping"][0]["checked"]


def test_ticks_survive_a_menu_edit(client, made):
    base = f"/api/share/{made['slug']}"
    client.post(f"{base}/check", json={"key": made["shopping"][0]["key"], "checked": True}, headers=W)
    doc = made["doc"]
    doc["days"][0]["headcount"] = 80
    v = client.put(f"/api/events/{made['id']}", json={"base_rev": 1, "doc": doc}, headers=W).json()
    assert v["shopping"][0]["amount"] == 6000 and v["shopping"][0]["checked"]


def test_household_changing_a_status_overrides_the_visitors(client, made):
    base = f"/api/share/{made['slug']}"
    client.post(f"{base}/dish/puffs", json={"status": "done"}, headers=W)
    doc = made["doc"]
    doc["days"][0]["dishes"][2]["status"] = "already_made"
    v = client.put(f"/api/events/{made['id']}", json={"base_rev": 1, "doc": doc}, headers=W).json()
    assert "puffs" not in v["dish_status"]


def test_writes_need_the_header_and_bad_targets_are_refused(anon, made):
    base = f"/api/share/{made['slug']}"
    assert anon.post(f"{base}/notes", json={"text": "hi"}).status_code == 403
    assert anon.post(f"{base}/check", json={"key": "nope|", "checked": True}, headers=W).status_code == 404
    assert anon.post(f"{base}/dish/nope", json={"status": "done"}, headers=W).status_code == 404
    assert anon.post(f"{base}/notes", json={"target": "dish:nope", "text": "x"}, headers=W).status_code == 404
    assert anon.post(f"{base}/notes", json={"text": "x" * 501}, headers=W).status_code == 422


def test_rotated_or_disabled_link_stops_working(client, made):
    old = made["slug"]
    rotated = client.post(f"/api/events/{made['id']}/share", json={"rotate": True}, headers=W).json()
    assert rotated["slug"] != old and events.split_slug(rotated["slug"])[0] == events.split_slug(old)[0]
    assert client.get(f"/api/share/{old}").status_code == 404
    assert client.get(f"/api/share/{rotated['slug']}").status_code == 200

    client.post(f"/api/events/{made['id']}/share", json={"enabled": False}, headers=W)
    assert client.get(f"/api/share/{rotated['slug']}").status_code == 404

    renamed = client.post(f"/api/events/{made['id']}/share", json={"enabled": True, "name": "MK lunch"}, headers=W).json()
    assert renamed["slug"].startswith("mk-lunch-")


def test_deleted_event_link_is_gone(client, made):
    client.delete(f"/api/events/{made['id']}", headers=W)
    assert client.get(f"/api/share/{made['slug']}").status_code == 404
    assert client.get("/api/events").json()["events"] == []


def test_added_items_are_capped(anon, made, monkeypatch):
    monkeypatch.setattr(events, "MAX_ITEMS", 1)
    base = f"/api/share/{made['slug']}"
    assert anon.post(f"{base}/items", json={"name": "A"}, headers=W).status_code == 200
    assert anon.post(f"{base}/items", json={"name": "B"}, headers=W).status_code == 409


def test_retried_add_with_the_pages_id_lands_once(anon, made):
    base = f"/api/share/{made['slug']}"
    body = {"id": "abc12345", "name": "Oat milk", "by": "Priya"}
    anon.post(f"{base}/items", json=body, headers=W)
    anon.post(f"{base}/items", json=body, headers=W)
    note = {"id": "note1234", "text": "Bring tubs"}
    anon.post(f"{base}/notes", json=note, headers=W)
    anon.post(f"{base}/notes", json=note, headers=W)
    v = anon.get(base).json()
    assert [i["id"] for i in v["items"]] == ["abc12345"]
    assert [n["id"] for n in v["notes"]] == ["note1234"]
    assert anon.post(f"{base}/items", json={"id": "bad id!", "name": "x"}, headers=W).status_code == 422
