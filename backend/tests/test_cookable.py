import json
from pathlib import Path

import pytest

from recipie.cookable import assess

CASES = json.loads((Path(__file__).parents[2] / "shared" / "cookable-cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_case(case):
    stock = None if case["stock"] is None else {int(k): v for k, v in case["stock"].items()}
    got = assess({"ingredients": case["ingredients"]}, stock)
    for key, want in case["expect"].items():
        assert got[key] == want, key
