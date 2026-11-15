"""A recipe's share link: off until made, read only, and gone when switched off."""

import pytest
from fastapi.testclient import TestClient

from recipie import config, db
from recipie.web import create_app

W = {"X-Recipie": "1"}

CURRY = {"title": "Chicken Curry", "servings": 4, "ingredients": [
    {"id": "chicken", "name": "Chicken", "amount": 500, "unit": "g", "role": "main", "grocy_product_ids": [1]},
    {"id": "oil", "name": "Coconut oil", "grocy_product_ids": [2], "substitutes": [{"name": "Ghee", "grocy_product_ids": [3]}]},
], "steps": [{"id": "s1", "text": "Cook it.", "ingredient_ids": ["chicken"]}]}


@pytest.fixture
def client():
    return TestClient(create_app())


@pytest.fixture
def recipe():
    return db.save(CURRY)


@pytest.fixture
def anon(monkeypatch):
    def make():
        monkeypatch.delenv("RECIPIE_DEV_USER")
        config.settings.cache_clear()
        return TestClient(create_app())
    return make


def test_no_link_until_one_is_made(client, recipe):
    assert client.get(f"/api/recipes/{recipe['id']}/share").json() == {"enabled": False, "slug": None, "url": None}
    s = client.post(f"/api/recipes/{recipe['id']}/share", json={}, headers=W).json()
    assert s["enabled"] and s["slug"].startswith("chicken-curry-") and s["url"] == f"http://localhost/s/{s['slug']}"
    # Asking again gives the same link, and the recipe's rev is untouched.
    assert client.post(f"/api/recipes/{recipe['id']}/share", json={}, headers=W).json() == s
    assert db.get(recipe["id"])["rev"] == recipe["rev"]


def test_link_opens_without_login_and_shows_edits(client, recipe, anon):
    s = client.post(f"/api/recipes/{recipe['id']}/share", json={}, headers=W).json()
    db.save({**CURRY, "title": "Nadan Chicken Curry"}, recipe_id=recipe["id"])
    visitor = anon()
    v = visitor.get(f"/api/recipe-share/{s['slug']}").json()
    assert v["doc"]["title"] == "Nadan Chicken Curry" and "id" not in v
    # The household's pantry links stay home.
    assert "grocy_product_ids" not in v["doc"]["ingredients"][0]
    assert v["doc"]["ingredients"][1]["substitutes"] == [{"name": "Ghee"}]
    # The link gives nothing else away.
    assert visitor.get(f"/api/recipes/{recipe['id']}/share").status_code == 401
    assert visitor.post(f"/api/recipes/{recipe['id']}/share", json={}, headers=W).status_code == 401
    assert visitor.get("/api/sync").status_code == 401


def test_rotated_switched_off_or_deleted_stops_working(client, recipe):
    rid = recipe["id"]
    old = client.post(f"/api/recipes/{rid}/share", json={}, headers=W).json()["slug"]
    new = client.post(f"/api/recipes/{rid}/share", json={"rotate": True}, headers=W).json()["slug"]
    assert new != old and new.rsplit("-", 1)[0] == old.rsplit("-", 1)[0]
    assert client.get(f"/api/recipe-share/{old}").status_code == 404
    assert client.get(f"/api/recipe-share/{new}").status_code == 200

    off = client.post(f"/api/recipes/{rid}/share", json={"enabled": False}, headers=W).json()
    assert off == {"enabled": False, "slug": None, "url": None}
    assert client.get(f"/api/recipe-share/{new}").status_code == 404

    # Switching back on brings the same link back.
    assert client.post(f"/api/recipes/{rid}/share", json={"enabled": True}, headers=W).json()["slug"] == new
    db.delete(rid)
    assert client.get(f"/api/recipe-share/{new}").status_code == 404
    assert client.post(f"/api/recipes/{rid}/share", json={}, headers=W).status_code == 404


def test_unknown_recipe_and_missing_header(client, recipe):
    assert client.post("/api/recipes/nope/share", json={}, headers=W).status_code == 404
    assert client.post(f"/api/recipes/{recipe['id']}/share", json={}).status_code == 403
    assert client.post("/api/recipes/nope/share", json={"enabled": False}, headers=W).status_code == 404
