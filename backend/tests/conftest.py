import pytest

from recipie import config, db, pantry

FAKE_PRODUCTS = [
    {"id": 1, "name": "Chicken", "unit": "g"},
    {"id": 2, "name": "Coconut oil", "unit": "bottle"},
    {"id": 3, "name": "Ghee", "unit": "jar"},
]


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("RECIPIE_DB", str(tmp_path / "test.db"))
    monkeypatch.setenv("RECIPIE_DEV_USER", "tester")
    monkeypatch.setenv("RECIPIE_PUBLIC_URL", "http://localhost")
    config.settings.cache_clear()
    db.init()
    pantry.set_source(lambda: {"products": FAKE_PRODUCTS, "stock": {1: 500.0, 3: 1.0}})
    yield
    config.settings.cache_clear()
