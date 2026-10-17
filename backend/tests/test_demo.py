"""The public demo: no login, nothing stored, never the real pantry."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from recipie import config, cookable, db, demo, pantry
from recipie.models import RecipeDoc
from recipie.web import create_app

DEMO = Path(__file__).parents[1] / "demo"


@pytest.fixture
def demo_client(monkeypatch):
    monkeypatch.delenv("RECIPIE_DEV_USER")
    monkeypatch.setenv("RECIPIE_DEMO", "1")
    monkeypatch.setenv("RECIPIE_PANTRY_FILE", str(DEMO / "pantry.json"))
    monkeypatch.setenv("RECIPIE_PUBLIC_URL", "https://recipes-demo.example")
    config.settings.cache_clear()
    pantry.set_source(pantry._from_file(str(DEMO / "pantry.json")))
    demo.seed(str(DEMO / "recipes.json"))
    return TestClient(create_app())


def test_demo_refuses_to_run_against_the_real_pantry(monkeypatch):
    monkeypatch.setenv("RECIPIE_DEMO", "1")
    monkeypatch.delenv("RECIPIE_PANTRY_FILE", raising=False)
    config.settings.cache_clear()
    with pytest.raises(RuntimeError, match="must not read the real pantry"):
        config.settings()


def test_no_login_needed_and_me_says_demo(demo_client):
    assert demo_client.get("/api/me").json() == {"username": "demo", "demo": True}
    assert demo_client.get("/auth/login", follow_redirects=False).headers["location"] == "/"


def test_writes_are_echoed_and_never_stored(demo_client):
    before = {r["id"]: r["rev"] for r in db.list_live()}
    doc = {"title": "Spam", "ingredients": [], "steps": []}
    res = demo_client.post("/api/sync", headers={"X-Recipie": "1"}, json={"changes": [
        {"id": "new1", "base_rev": 0, "doc": doc},
        {"id": "egg-roast", "base_rev": 1, "deleted": True},
    ]}).json()["results"]
    assert res[0]["status"] == "ok" and res[0]["row"]["doc"]["title"] == "Spam"
    assert res[1] == {"id": "egg-roast", "status": "ok", "row": None}
    assert {r["id"]: r["rev"] for r in db.list_live()} == before


def test_demo_data_shows_every_status():
    recipes = json.loads((DEMO / "recipes.json").read_text())["recipes"]
    stock = {int(k): v for k, v in json.loads((DEMO / "pantry.json").read_text())["stock"].items()}
    product_ids = {p["id"] for p in json.loads((DEMO / "pantry.json").read_text())["products"]}
    statuses = {}
    for r in recipes:
        doc = RecipeDoc.model_validate(r["recipe"]).model_dump()  # also checks step references
        for ing in doc["ingredients"]:
            assert set(ing["grocy_product_ids"]) <= product_ids, ing["name"]
        statuses[r["id"]] = cookable.assess(doc, stock)["status"]
    assert statuses == {
        "nadan-chicken-curry": "ready", "egg-roast": "ready", "ghee-rice": "ready", "semiya-payasam": "ready",
        "kerala-parippu": "almost", "sambar": "almost", "prawn-moilee": "no", "kappa-puzhukku": "unknown",
    }
