"""What is in the pantry, read from Grocy through the grocy-mcp package.

Reads only. One snapshot is a handful of Grocy calls, cached briefly so a page
of recipes, or Claude asking about ten of them, costs one fetch rather than
ten. If Grocy is unreachable the last good snapshot is served, marked stale,
rather than turning every recipe red.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Callable

from .config import settings

log = logging.getLogger(__name__)


def _from_grocy() -> dict:
    from grocy_mcp.api import get  # imported late: tests run without Grocy

    units = {u["id"]: u["name"] for u in get("/objects/quantity_units")}
    products = [
        {"id": int(p["id"]), "name": p["name"], "unit": units.get(p["qu_id_stock"], "")}
        for p in get("/objects/products")
    ]
    # /stock lists only products with something on hand; zero means absent.
    stock = {int(e["product_id"]): float(e["amount_aggregated"]) for e in get("/stock")}
    return {"products": products, "stock": stock}


def _from_file(path: str) -> Callable[[], dict]:
    """Local development without a Grocy: {"products": [...], "stock": {"id": amount}}."""
    def read() -> dict:
        with open(path) as f:
            data = json.load(f)
        return {"products": data["products"], "stock": {int(k): float(v) for k, v in data["stock"].items()}}
    return read


_source: Callable[[], dict] = (
    _from_file(os.environ["RECIPIE_PANTRY_FILE"]) if os.environ.get("RECIPIE_PANTRY_FILE") else _from_grocy
)
_lock = threading.Lock()
_cached: dict | None = None
_cached_at = 0.0


def set_source(fn: Callable[[], dict]) -> None:
    """Swap where stock comes from (tests, local development)."""
    global _source, _cached, _cached_at
    _source, _cached, _cached_at = fn, None, 0.0


def snapshot(max_age: float | None = None) -> dict:
    """{fetched_at, stale, error?, products: [...], stock: {id: amount}}."""
    global _cached, _cached_at
    ttl = settings().pantry_ttl_seconds if max_age is None else max_age
    with _lock:
        if _cached is not None and time.monotonic() - _cached_at < ttl:
            return _cached
        try:
            data = _source()
        except Exception as exc:
            log.warning("pantry read failed: %s", exc)
            if _cached is not None:
                return {**_cached, "stale": True, "error": str(exc)}
            return {"fetched_at": None, "stale": True, "error": str(exc), "products": [], "stock": None}
        _cached = {
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "stale": False,
            **data,
        }
        _cached_at = time.monotonic()
        return _cached


def stock() -> dict[int, float] | None:
    return snapshot()["stock"]


def search(query: str, limit: int = 15) -> list[dict]:
    snap = snapshot()
    q = query.casefold().strip()
    stock_map = snap["stock"] or {}
    hits = [p for p in snap["products"] if q in p["name"].casefold()]
    # Exact and prefix matches first: "oil" should offer "Oil" before "Coconut oil".
    hits.sort(key=lambda p: (p["name"].casefold() != q, not p["name"].casefold().startswith(q), p["name"]))
    return [{**p, "in_stock": stock_map.get(p["id"], 0) > 0, "amount": stock_map.get(p["id"], 0)} for p in hits[:limit]]
