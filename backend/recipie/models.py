"""The recipe document.

A recipe is stored and synced as one JSON document. Ingredients and steps are
embedded rather than normalised into tables: the unit of editing, of syncing
and of conflict is the whole recipe, and splitting it would only create ways
for half an edit to arrive.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

# main:     the dish is not the dish without it (chicken in a chicken curry).
# minor:    needed, but a cook can work around it (coconut oil, curry leaves).
# optional: garnish or "if you have it"; never affects whether you can cook.
Role = Literal["main", "minor", "optional"]


def new_id() -> str:
    return uuid.uuid4().hex


class Substitute(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    grocy_product_id: int | None = None


class Ingredient(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str = Field(min_length=1, max_length=120)
    amount: float | None = None
    unit: str = Field(default="", max_length=40)
    note: str = Field(default="", max_length=200, description="e.g. 'finely chopped'")
    group: str = Field(default="", max_length=60, description="e.g. 'For the marinade'")
    role: Role = "minor"
    grocy_product_id: int | None = Field(
        default=None, description="Grocy product this ingredient is checked against"
    )
    substitutes: list[Substitute] = Field(default_factory=list, max_length=8)


class Step(BaseModel):
    id: str = Field(default_factory=new_id)
    text: str = Field(min_length=1, max_length=2000)
    timer_seconds: int | None = Field(default=None, ge=1, le=24 * 3600)


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
