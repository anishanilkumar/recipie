"""The recipe document.

A recipe is stored and synced as one JSON document. Ingredients and steps are
embedded rather than normalised into tables: the unit of editing, of syncing
and of conflict is the whole recipe, and splitting it would only create ways
for half an edit to arrive.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, model_validator

# main:     the dish is not the dish without it (chicken in a chicken curry).
# minor:    needed, but a cook can work around it (coconut oil, curry leaves).
# optional: garnish or "if you have it"; never affects whether you can cook.
Role = Literal["main", "minor", "optional"]


def new_id() -> str:
    return uuid.uuid4().hex


class _PantryLinks(BaseModel):
    """Grocy products that count as this item.

    A list because Grocy keeps each pack size as its own product ("White
    Onions, 2 kg" and "White Onions, 5 kg"). Linking only one made the recipe
    say "out" whenever the other size was the one in the cupboard; with all of
    them listed, any one in stock counts.
    """

    grocy_product_ids: list[int] = Field(
        default_factory=list, max_length=20,
        description="Every Grocy product that counts as this item, e.g. each pack size",
    )

    @model_validator(mode="before")
    @classmethod
    def _single_id(cls, data):
        # Recipes saved before October 2026 carry one `grocy_product_id`.
        if isinstance(data, dict) and "grocy_product_id" in data:
            data = dict(data)
            old = data.pop("grocy_product_id")
            ids = list(data.get("grocy_product_ids") or [])
            if old is not None and old not in ids:
                ids.insert(0, old)
            data["grocy_product_ids"] = ids
        return data


class Substitute(_PantryLinks):
    name: str = Field(min_length=1, max_length=120)


class Ingredient(_PantryLinks):
    id: str = Field(default_factory=new_id)
    name: str = Field(min_length=1, max_length=120)
    amount: float | None = None
    unit: str = Field(default="", max_length=40)
    # The same quantity in a second measure, shown alongside: grams in
    # `amount`, and here what you'd scoop or count ("¾ tsp", "9 medium").
    alt_amount: float | None = None
    alt_unit: str = Field(default="", max_length=40)
    note: str = Field(default="", max_length=200, description="e.g. 'finely chopped'")
    group: str = Field(default="", max_length=60, description="e.g. 'For the marinade'")
    role: Role = "minor"
    substitutes: list[Substitute] = Field(default_factory=list, max_length=8)


class Step(BaseModel):
    id: str = Field(default_factory=new_id)
    text: str = Field(min_length=1, max_length=2000)
    timer_seconds: int | None = Field(default=None, ge=1, le=24 * 3600)
    ingredient_ids: list[str] = Field(
        default_factory=list, max_length=50,
        description="Ids of the ingredients this step uses; cook mode shows their measurements on the step",
    )


class RecipeDoc(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    servings: int | None = Field(default=None, ge=1, le=100)
    prep_minutes: int | None = Field(default=None, ge=0, le=7 * 24 * 60)
    cook_minutes: int | None = Field(default=None, ge=0, le=7 * 24 * 60)
    tags: list[str] = Field(default_factory=list, max_length=20)
    source: str = Field(default="", max_length=500)
    ingredients: list[Ingredient] = Field(default_factory=list, max_length=100)
    steps: list[Step] = Field(default_factory=list, max_length=100)
    notes: str = Field(default="", max_length=5000)

    @model_validator(mode="after")
    def _references(self):
        ids = [i.id for i in self.ingredients]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(f"Ingredient ids must be unique within a recipe; repeated: {', '.join(dupes)}")
        known = set(ids)
        for n, step in enumerate(self.steps, 1):
            unknown = [i for i in step.ingredient_ids if i not in known]
            if unknown:
                raise ValueError(f"Step {n} uses ingredient ids that are not in this recipe: {', '.join(unknown)}")
        return self


# --- events -----------------------------------------------------------------
#
# An event is a menu cooked for other people, possibly over several days, with
# a shopping list shared through a link. Like a recipe, the menu is one
# document owned and edited by the household; what visitors with the link do
# (ticks, added items, notes, "done") is kept beside it in its own tables
# (db.py), so a stranger's tick never bumps the menu's rev or conflicts with
# an edit.

# todo:         still to cook.
# already_made: cooked ahead (or bought); adds nothing to the shopping list.
# done:         cooked for this event.
DishStatus = Literal["todo", "already_made", "done"]


class EventItem(BaseModel):
    """An ingredient typed in for the event, already in event quantities."""

    id: str = Field(default_factory=new_id)
    name: str = Field(min_length=1, max_length=120)
    amount: float | None = None
    unit: str = Field(default="", max_length=40)


class Dish(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=500, description="e.g. 'stir-fried cabbage and carrot with coconut'")
    recipe_id: str | None = Field(default=None, max_length=64, description="A recipe in the book; its ingredients go on the shopping list")
    assignee: str = Field(default="", max_length=80, description="Who is cooking it")
    effort: str = Field(default="", max_length=40, description="e.g. 'low'")
    status: DishStatus = "todo"
    extra_ingredients: list[EventItem] = Field(
        default_factory=list, max_length=50,
        description="Typed-in ingredients in event quantities, for dishes without a recipe or additions to one",
    )


class Day(BaseModel):
    id: str = Field(default_factory=new_id)
    label: str = Field(min_length=1, max_length=80, description="e.g. 'Day 1' or 'Saturday lunch'")
    date: str = Field(default="", max_length=10, description="YYYY-MM-DD, optional")
    headcount: int | None = Field(default=None, ge=1, le=10000, description="Recipe quantities are scaled to this")
    dishes: list[Dish] = Field(default_factory=list, max_length=60)


class EventDoc(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    dietary_notes: str = Field(default="", max_length=2000, description="e.g. 'All vegetarian, mild spice. Contains dairy: pulissery.'")
    days: list[Day] = Field(default_factory=list, max_length=30)
    hidden_keys: list[str] = Field(
        default_factory=list, max_length=200,
        description="Shopping-list keys left off the list (salt, water)",
    )

    @model_validator(mode="after")
    def _unique_ids(self):
        days = [d.id for d in self.days]
        dishes = [x.id for d in self.days for x in d.dishes]
        for kind, ids in (("Day", days), ("Dish", dishes)):
            dupes = sorted({i for i in ids if ids.count(i) > 1})
            if dupes:
                raise ValueError(f"{kind} ids must be unique within an event; repeated: {', '.join(dupes)}")
        return self
