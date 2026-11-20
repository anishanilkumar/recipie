"""The whole book's share links: one per friend, read only, archived recipes left out."""

import pytest
from fastapi.testclient import TestClient

from recipie import config, db
from recipie.web import create_app

W = {"X-Recipie": "1"}
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100

CURRY = {"title": "Chicken Curry", "servings": 4, "ingredients": [
    {"id": "chicken", "name": "Chicken", "amount": 500, "unit": "g", "role": "main", "grocy_product_ids": [1]},
    {"id": "oil", "name": "Coconut oil", "grocy_product_ids": [2], "substitutes": [{"name": "Ghee", "grocy_product_ids": [3]}]},
], "steps": [{"id": "s1", "text": "Cook it.", "ingredient_ids": ["chicken"]}]}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("RECIPIE_PHOTOS", str(tmp_path / "photos"))
    config.settings.cache_clear()
    return TestClient(create_app())


@pytest.fixture
def anon(monkeypatch):
    def make():
        monkeypatch.delenv("RECIPIE_DEV_USER")
        config.settings.cache_clear()
        return TestClient(create_app())
    return make


def make_link(client, name="Rahul"):
    res = client.post("/api/book-links", json={"name": name}, headers=W)
    assert res.status_code == 200, res.text
    return res.json()


def test_link_opens_the_book_without_login(client, anon):
    curry = db.save(CURRY)
    db.save({"title": "Appam", "ingredients": [], "steps": []})
    db.save({"title": "Old party rice", "archived": True, "ingredients": [], "steps": []})
    gone = db.save({"title": "Deleted dal", "ingredients": [], "steps": []})
    db.delete(gone["id"])
    link = make_link(client)
    assert link["enabled"] and link["name"] == "Rahul"
    assert link["slug"].startswith("rahul-") and len(link["slug"].rsplit("-", 1)[1]) == 10
    assert link["url"] == f"http://localhost/b/{link['slug']}"

    # Added after the link was made: it shows anyway.
    db.save({"title": "Banana bread", "ingredients": [], "steps": []})

    visitor = anon()
    book = visitor.get(f"/api/book/{link['slug']}").json()
    assert [r["doc"]["title"] for r in book["recipes"]] == ["Appam", "Banana bread", "Chicken Curry"]
    shown = next(r for r in book["recipes"] if r["id"] == curry["id"])
    assert "grocy_product_ids" not in shown["doc"]["ingredients"][0]
    assert shown["doc"]["ingredients"][1]["substitutes"] == [{"name": "Ghee"}]
    assert isinstance(book["categories"], list)
    # The link gives nothing else away.
    assert visitor.get("/api/book-links").status_code == 401
    assert visitor.post("/api/book-links", json={"name": "Me"}, headers=W).status_code == 401
    assert visitor.get("/api/sync").status_code == 401
    assert visitor.get("/api/photos").status_code == 401


def test_photos_come_with_the_book_but_not_for_archived(client, anon):
    curry = db.save(CURRY)
    old = db.save({"title": "Old party rice", "archived": True, "ingredients": [], "steps": []})
    for r in (curry, old):
        assert client.put(f"/api/recipes/{r['id']}/photo", content=JPEG, headers=W).status_code == 200
    slug = make_link(client)["slug"]

    visitor = anon()
    book = visitor.get(f"/api/book/{slug}").json()
    assert set(book["photos"]) == {curry["id"]}
    res = visitor.get(f"/api/book/{slug}/photos/{curry['id']}/own/thumb")
    assert res.status_code == 200 and res.content == JPEG
    assert visitor.get(f"/api/book/{slug}/photos/{old['id']}/own/full").status_code == 404
    assert visitor.get(f"/api/book/{slug}/photos/{curry['id']}/bogus/full").status_code == 404
    assert visitor.get(f"/api/book/nope-aaaaaaaaaa/photos/{curry['id']}/own/full").status_code == 404


def test_each_friend_has_their_own_link(client):
    db.save(CURRY)
    a = make_link(client, "Rahul")
    b = make_link(client, "Priya & Sam")
    assert b["slug"].startswith("priya-sam-")
    assert [x["name"] for x in client.get("/api/book-links").json()["links"]] == ["Rahul", "Priya & Sam"]

    # Rahul's is switched off; Priya's still works.
    off = client.post(f"/api/book-links/{a['id']}", json={"enabled": False}, headers=W).json()
    assert off["enabled"] is False
    assert client.get(f"/api/book/{a['slug']}").status_code == 404
    assert client.get(f"/api/book/{b['slug']}").status_code == 200
    # Back on: the same link.
    assert client.post(f"/api/book-links/{a['id']}", json={"enabled": True}, headers=W).json()["slug"] == a["slug"]

    # A new secret: the old one stops, the words stay.
    new = client.post(f"/api/book-links/{b['id']}", json={"rotate": True}, headers=W).json()
    assert new["slug"] != b["slug"] and new["slug"].startswith("priya-sam-")
    assert client.get(f"/api/book/{b['slug']}").status_code == 404
    assert client.get(f"/api/book/{new['slug']}").status_code == 200

    # A rename is for the household's list only.
    renamed = client.post(f"/api/book-links/{b['id']}", json={"name": "Priya"}, headers=W).json()
    assert renamed["name"] == "Priya" and renamed["slug"] == new["slug"]

    assert client.delete(f"/api/book-links/{a['id']}", headers=W).status_code == 200
    assert client.get(f"/api/book/{a['slug']}").status_code == 404
    assert [x["name"] for x in client.get("/api/book-links").json()["links"]] == ["Priya"]


def test_bad_requests(client):
    assert client.post("/api/book-links", json={"name": "Rahul"}).status_code == 403
    assert client.post("/api/book-links", json={"name": "   "}, headers=W).status_code == 422
    assert client.post("/api/book-links/nope", json={"enabled": False}, headers=W).status_code == 404
    assert client.delete("/api/book-links/nope", headers=W).status_code == 404
    assert client.get("/api/book/nope-aaaaaaaaaa").status_code == 404
