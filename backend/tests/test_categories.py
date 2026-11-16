"""The household's categories: five to start, replaced as a whole, shared."""

from fastapi.testclient import TestClient

from recipie import categories
from recipie.web import create_app

W = {"X-Recipie": "1"}


def test_starts_with_the_five_and_is_replaced_whole():
    c = TestClient(create_app())
    assert c.get("/api/categories").json() == {"categories": ["Baking", "Rice cooker", "Curry", "Oven", "Noodles"]}
    out = c.put("/api/categories", headers=W, json={"categories": [" Baking ", "Rice-cooker", "rice cooker", "", "Dessert"]})
    # Trimmed, repeats (by tag key) dropped, order kept.
    assert out.json() == {"categories": ["Baking", "Rice-cooker", "Dessert"]}
    assert c.get("/api/categories").json()["categories"] == ["Baking", "Rice-cooker", "Dessert"]
    assert c.put("/api/categories", headers=W, json={"categories": ["x" * 41]}).status_code == 422


def test_key_matches_the_apps():
    assert categories.key(" Rice-Cooker ") == "rice cooker"
