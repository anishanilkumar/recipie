import asyncio

import pytest

from recipie import db
from recipie.mcp_server import build_server

CURRY = {
    "title": "Chicken curry",
    "tags": ["kerala"],
    "ingredients": [
        {"name": "Chicken", "role": "main", "grocy_product_ids": [1]},
        {"name": "Coconut oil", "role": "minor", "grocy_product_ids": [2],
         "substitutes": [{"name": "Ghee", "grocy_product_ids": [3]}]},
    ],
}


def call(name, **args):
    server = build_server(host="127.0.0.1", port=8771, public_host=None, public_url=None, auth=False)
    # Through the tool manager, so arguments are validated against the tool's
    # schema exactly as for a real client, but the Python result comes back
    # unwrapped (call_tool's wrapping differs between SDK versions).
    return asyncio.run(server._tool_manager.call_tool(name, args))


def test_save_then_check_cookable():
    saved = call("save_recipe", recipe=CURRY)
    assert saved["rev"] == 1
    # Coconut oil is out but ghee is in, so it is ready with a swap.
    assert saved["pantry_check"]["status"] == "ready"
    assert saved["pantry_check"]["swaps"] == [{"ingredient": "Coconut oil", "use": "Ghee"}]

    groups = call("whats_cookable")
    assert [r["title"] for r in groups["ready"]] == ["Chicken curry"]


def test_save_with_stale_rev_is_refused():
    saved = call("save_recipe", recipe=CURRY)
    db.save({**CURRY, "title": "Edited on phone"}, recipe_id=saved["id"])
    with pytest.raises(Exception, match="Someone edited it"):
        call("save_recipe", recipe=CURRY, id=saved["id"], expected_rev=1)


def test_get_by_title_and_delete_restore():
    saved = call("save_recipe", recipe=CURRY)
    assert call("get_recipe", id_or_title="chicken curry")["id"] == saved["id"]
    call("delete_recipe", id=saved["id"])
    assert call("list_recipes") == []
    call("restore_recipe", id=saved["id"])
    assert [r["title"] for r in call("list_recipes", tag="Kerala")] == ["Chicken curry"]


def test_find_pantry_products():
    hits = call("find_pantry_products", query="oil")
    assert hits[0]["name"] == "Coconut oil" and hits[0]["in_stock"] is False


def test_any_pack_size_in_stock_counts():
    # 2 (out) and 1 (in stock) both linked: the in-stock one is enough.
    saved = call("save_recipe", recipe={"title": "Fry", "ingredients": [
        {"name": "Chicken", "role": "main", "grocy_product_ids": [2, 1]}]})
    assert saved["pantry_check"]["status"] == "ready"
