import json
from pathlib import Path

import pytest

from recipie.models import RecipeDoc
from recipie.timing import totals

CASES = json.loads((Path(__file__).parents[2] / "shared" / "timing-cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_case(case):
    assert totals(case["steps"]) == case["expect"]


def test_step_fields_round_trip():
    doc = RecipeDoc(title="Banana bread", steps=[
        {"text": "Bake", "kind": "passive", "timer_seconds": 3600, "oven": True},
        {"text": "Cool overnight", "kind": "setting", "minutes": 480},
    ])
    steps = doc.model_dump()["steps"]
    assert (steps[0]["kind"], steps[0]["oven"], steps[1]["minutes"]) == ("passive", True, 480)


def test_old_steps_still_load():
    doc = RecipeDoc(title="Dal", steps=[{"text": "Boil", "timer_seconds": 600}])
    assert doc.steps[0].kind is None and doc.steps[0].oven is False
