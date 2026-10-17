"""Seed a local database with a few recipes, for development.

    RECIPIE_DB=dev.db python dev/seed.py
"""

from recipie import db

I = lambda name, amount=None, unit="", role="minor", pid=None, subs=(), note="", group="": {  # noqa: E731
    "name": name, "amount": amount, "unit": unit, "role": role, "grocy_product_ids": [pid] if pid else [],
    "substitutes": [{"name": n, "grocy_product_ids": [p]} for n, p in subs], "note": note, "group": group,
}

RECIPES = [
    {
        "title": "Nadan chicken curry",
        "description": "Kerala-style, with roasted coconut milk gravy. Better the next day.",
        "servings": 4, "prep_minutes": 20, "cook_minutes": 40, "tags": ["kerala", "weekend"],
        "ingredients": [
            I("Chicken thighs", 800, "g", "main", 1, note="bone-in, cut small"),
            I("Coconut oil", 3, "tbsp", "minor", 2, subs=[("Ghee", 3), ("Sunflower oil", 14)]),
            I("Onion", 2, "", "minor", 4, note="thinly sliced"),
            I("Curry leaves", 2, "sprigs", "minor", 5),
            I("Ginger", 30, "g", "minor", 11, note="crushed"),
            I("Kashmiri chilli powder", 1.5, "tbsp", "minor", 12),
            I("Coconut milk", 1, "can", "minor", 7),
            I("Salt", None, "", "minor", note="to taste"),
        ],
        "steps": [
            {"text": "Heat the oil and splutter the curry leaves."},
            {"text": "Fry the onions with a pinch of salt until deep golden, about 12 minutes.", "timer_seconds": 720},
            {"text": "Add ginger and chilli powder; stir for a minute until the raw smell goes."},
            {"text": "Add the chicken, coat well, cover and cook on medium for 20 minutes.", "timer_seconds": 1200},
            {"text": "Pour in the coconut milk, bring just to a simmer and switch off."},
        ],
        "notes": "Finish with a spoon of coconut oil and fresh curry leaves if you have them.",
        "source": "Amma",
    },
    {
        "title": "Prawn moilee",
        "servings": 3, "cook_minutes": 25, "tags": ["kerala", "seafood"],
        "ingredients": [
            I("Prawns", 400, "g", "main", 10),
            I("Coconut milk", 1, "can", "main", 7),
            I("Onion", 1, "", "minor", 4),
            I("Curry leaves", 1, "sprig", "minor", 5),
        ],
        "steps": [{"text": "Sauté onion and curry leaves."}, {"text": "Add coconut milk and prawns; simmer 6 minutes.", "timer_seconds": 360}],
    },
    {
        "title": "Ghee rice",
        "servings": 4, "cook_minutes": 30, "tags": ["rice"],
        "ingredients": [
            I("Basmati rice", 2, "cups", "main", 8),
            I("Ghee", 3, "tbsp", "main", 3),
            I("Onion", 1, "", "minor", 4),
            I("Cashews", 2, "tbsp", "optional"),
        ],
        "steps": [{"text": "Soak the rice 20 minutes.", "timer_seconds": 1200}, {"text": "Fry onion in ghee, add rice and water, cook covered."}],
    },
    {
        "title": "Egg roast",
        "servings": 2, "cook_minutes": 25, "tags": ["kerala", "weeknight"],
        "ingredients": [
            I("Eggs", 4, "", "main", 9, note="hard-boiled"),
            I("Onion", 3, "", "minor", 4),
            I("Tomato", 1, "", "minor", 6),
            I("Coconut oil", 2, "tbsp", "minor", 2),
            I("Curry leaves", 1, "sprig", "minor", 5),
        ],
        "steps": [{"text": "Slow-fry onions until jammy."}, {"text": "Add tomato and spices, then the eggs."}],
    },
    {
        "title": "Parippu (dal)",
        "servings": 4, "cook_minutes": 30, "tags": ["kerala", "sadya"],
        "ingredients": [
            I("Moong dal", 1, "cup", "main"),
            I("Ghee", 1, "tbsp", "minor", 3),
        ],
        "steps": [{"text": "Pressure-cook the dal with turmeric."}, {"text": "Temper with ghee."}],
    },
]

if __name__ == "__main__":
    db.init()
    for r in RECIPES:
        row = db.save(r, user="seed")
        print(row["id"], row["doc"]["title"])
