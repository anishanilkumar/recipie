"""A recipe's photos: the plate photo, the web stand-in with its credit, and the listing."""

import pytest
from fastapi.testclient import TestClient

from recipie import db, photos
from recipie.web import create_app

W = {"X-Recipie": "1"}
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"0" * 50
OV_ID = "6a880374-88a4-419f-9100-b25693678ffc"
OV_RESULT = {
    "id": OV_ID, "title": "Banana Bread", "creator": "Smaku", "creator_url": "https://www.flickr.com/photos/x",
    "license": "by-nc-nd", "license_version": "2.0", "license_url": "https://creativecommons.org/licenses/by-nc-nd/2.0/",
    "foreign_landing_url": "https://www.flickr.com/photos/x/1", "source": "flickr", "width": 1024, "height": 768,
}


@pytest.fixture
def client():
    return TestClient(create_app())


@pytest.fixture
def recipe():
    return db.save({"title": "Kerala Egg Puffs (24)", "ingredients": [], "steps": []})


@pytest.fixture
def openverse(monkeypatch):
    asked: list[str] = []

    def get_json(url):
        asked.append(url)
        if "/images/?" in url:
            return {"results": [OV_RESULT, {"id": "not-an-id"}]}
        return OV_RESULT

    monkeypatch.setattr(photos, "_get_json", get_json)
    monkeypatch.setattr(photos, "_get_bytes", lambda url: WEBP)
    return asked


def test_plate_photo_is_stored_and_listed_without_touching_the_recipe(client, recipe):
    rid = recipe["id"]
    assert client.put(f"/api/recipes/{rid}/photo", content=JPEG, headers=W).json() == {"kept": False}
    listed = client.get("/api/photos").json()["photos"]
    assert set(listed[rid]) == {"own"}
    v = listed[rid]["own"]["v"]
    res = client.get(f"/api/photos/{rid}/own/full?v={v}")
    assert res.content == JPEG and res.headers["content-type"] == "image/jpeg"
    assert "immutable" in res.headers["cache-control"]
    # No thumbnail sent: the thumb is the full photo.
    assert client.get(f"/api/photos/{rid}/own/thumb").content == JPEG
    assert db.get(rid)["rev"] == recipe["rev"]


def test_keep_leaves_the_first_plate_photo(client, recipe):
    rid = recipe["id"]
    client.put(f"/api/recipes/{rid}/photo", content=JPEG, headers=W)
    other = b"\xff\xd8\xff\xe1" + b"1" * 10
    assert client.put(f"/api/recipes/{rid}/photo?keep=1", content=other, headers=W).json() == {"kept": True}
    assert client.get(f"/api/photos/{rid}/own/full").content == JPEG
    # A thumbnail goes with the photo that's there.
    client.put(f"/api/recipes/{rid}/photo?size=thumb", content=other, headers=W)
    assert client.get(f"/api/photos/{rid}/own/thumb").content == other


def test_only_jpeg_and_only_for_a_recipe_on_the_server(client, recipe):
    assert client.put(f"/api/recipes/{recipe['id']}/photo", content=b"GIF89a", headers=W).status_code == 422
    assert client.put("/api/recipes/nope/photo", content=JPEG, headers=W).status_code == 404
    # A thumbnail with no photo before it.
    assert client.put(f"/api/recipes/{recipe['id']}/photo?size=thumb", content=JPEG, headers=W).status_code == 422


def test_search_shortens_the_title_and_drops_bad_ids(client, recipe, openverse):
    res = client.get(f"/api/recipes/{recipe['id']}/photo/search").json()
    assert [r["id"] for r in res["results"]] == [OV_ID]
    assert res["results"][0]["credit"]["licence"] == "CC BY-NC-ND 2.0"
    # Only one result each time, so it tried the shorter terms too.
    assert [u.split("q=")[1].split("&")[0] for u in openverse] == ["kerala%20egg%20puffs", "egg%20puffs", "puffs"]
    own = client.get(f"/api/recipes/{recipe['id']}/photo/search?q=egg%20puff").json()
    assert own["query"] == "egg puff"


def test_web_stand_in_keeps_the_credit_from_openverse(client, recipe, openverse):
    rid = recipe["id"]
    out = client.post(f"/api/recipes/{rid}/photo/web", json={"id": OV_ID}, headers=W).json()
    credit = out["web"]["credit"]
    assert credit["creator"] == "Smaku" and credit["landing_url"].endswith("/1") and credit["via"] == "Openverse"
    assert client.get(f"/api/photos/{rid}/web/full").headers["content-type"] == "image/webp"
    assert client.post(f"/api/recipes/{rid}/photo/web", json={"id": "../../etc"}, headers=W).status_code == 422
    # Both slots can be filled; removing one leaves the other.
    client.put(f"/api/recipes/{rid}/photo", content=JPEG, headers=W)
    assert set(client.delete(f"/api/recipes/{rid}/photo/own", headers=W).json()) == {"web"}


def test_deleted_recipes_drop_out_of_the_listing(client, recipe):
    client.put(f"/api/recipes/{recipe['id']}/photo", content=JPEG, headers=W)
    db.delete(recipe["id"])
    assert client.get("/api/photos").json()["photos"] == {}


def test_search_terms():
    assert photos.search_terms("Thiruvananthapuram Inji Curry (for 50)") == [
        "thiruvananthapuram inji curry", "inji curry", "curry"]
    assert photos.search_terms("Rajma (30)") == ["rajma"]
    assert photos.licence_label("cc0") == "CC0"
