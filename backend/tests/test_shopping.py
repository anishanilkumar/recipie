from recipie import shopping

RAJMA = {"title": "Rajma", "servings": 4, "ingredients": [
    {"name": "Kidney beans", "amount": 250, "unit": "g", "role": "main"},
    {"name": "Onion", "amount": 300, "unit": "g", "alt_amount": 2, "alt_unit": "medium", "role": "minor"},
    {"name": "Coriander leaves", "amount": 10, "unit": "g", "role": "optional"},
    {"name": "Salt", "role": "minor"},
]}
THORAN = {"title": "Cabbage thoran", "servings": 4, "ingredients": [
    {"name": "Cabbage", "amount": 500, "unit": "g", "role": "main"},
    {"name": "onion", "amount": 150, "unit": "g", "alt_amount": 1, "alt_unit": "medium", "role": "minor"},
]}
RECIPES = {"rajma": RAJMA, "thoran": THORAN}


def event(**over):
    doc = {"title": "Migrant Kitchen", "days": [
        {"id": "d1", "label": "Day 1", "headcount": 40, "dishes": [
            {"id": "rajma", "name": "Rajma", "recipe_id": "rajma"},
            {"id": "thoran1", "name": "Cabbage thoran", "recipe_id": "thoran"},
            {"id": "inji", "name": "Inji curry", "status": "already_made",
             "extra_ingredients": [{"name": "Ginger", "amount": 1, "unit": "kg"}]},
            {"id": "puffs", "name": "Egg puffs", "extra_ingredients": [
                {"name": "Eggs", "amount": 30, "unit": ""}, {"name": "Puff pastry", "amount": 2, "unit": "kg"}]},
        ]},
        {"id": "d2", "label": "Day 2", "headcount": 20, "dishes": [
            {"id": "thoran2", "name": "Cabbage thoran", "recipe_id": "thoran"},
        ]},
    ]}
    doc.update(over)
    return doc


def by_name(listing):
    return {i["name"].casefold(): i for i in listing["items"]}


def test_scaled_by_each_days_headcount_and_summed():
    items = by_name(shopping.build(event(), RECIPES))
    # 40/4 = ×10 on day 1, 20/4 = ×5 on day 2.
    assert items["kidney beans"]["amount"] == 2500
    assert items["cabbage"]["amount"] == 500 * 10 + 500 * 5
    assert [s["day"] for s in items["cabbage"]["sources"]] == ["Day 1", "Day 2"]
    assert items["cabbage"]["sources"][0]["factor"] == 10


def test_same_name_any_case_is_one_line_with_kitchen_measure_summed():
    onion = by_name(shopping.build(event(), RECIPES))["onion"]
    assert onion["amount"] == 300 * 10 + 150 * 10 + 150 * 5
    assert (onion["alt_amount"], onion["alt_unit"]) == (2 * 10 + 1 * 10 + 1 * 5, "medium")


def test_already_made_adds_nothing_and_kg_becomes_g():
    items = by_name(shopping.build(event(), RECIPES))
    assert "ginger" not in items
    assert (items["puff pastry"]["amount"], items["puff pastry"]["unit"]) == (2000, "g")
    assert items["eggs"]["amount"] == 30


def test_a_visitor_marking_a_dish_already_made_takes_it_off():
    items = by_name(shopping.build(event(), RECIPES, dish_status={"rajma": {"status": "already_made"}}))
    assert "kidney beans" not in items


def test_optional_sorted_last_and_unmeasured_flagged():
    listing = shopping.build(event(), RECIPES)
    assert listing["items"][-1]["name"] == "Coriander leaves" and listing["items"][-1]["optional"]
    salt = by_name(listing)["salt"]
    assert salt["amount"] is None and salt["unmeasured"]


def test_hidden_and_ticked_rows_are_flagged():
    k = shopping.key("Salt", "")
    listing = shopping.build(event(hidden_keys=[k]), RECIPES,
                             checks={shopping.key("Cabbage", "g"): {"checked": True, "by": "Priya", "at": ""}})
    items = by_name(listing)
    assert items["salt"]["hidden"]
    assert items["cabbage"]["checked"] and items["cabbage"]["checked_by"] == "Priya"


def test_not_scaled_when_headcount_or_servings_missing():
    doc = event()
    doc["days"][1]["headcount"] = None
    listing = shopping.build(doc, {**RECIPES, "thoran": {**THORAN, "servings": None}})
    cabbage = by_name(listing)["cabbage"]
    assert cabbage["not_scaled"] and cabbage["amount"] == 1000
    assert any("Day 2" in w and "headcount" in w for w in listing["warnings"])


def test_missing_recipe_is_a_warning_not_an_error():
    listing = shopping.build(event(), {"thoran": THORAN})
    assert any("Rajma" in w for w in listing["warnings"])
