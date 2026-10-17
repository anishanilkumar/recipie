"""Load the public demo's recipes, replacing whatever the database holds.

Run before the demo server starts (ExecStartPre), so every restart puts the
demo back exactly as shipped. The demo server never stores a visitor's edits
(web.py, _echo), so in practice the database only ever changes here.
"""

from __future__ import annotations

import json
import logging

from . import db

log = logging.getLogger(__name__)


def seed(path: str) -> None:
    with open(path) as f:
        recipes = json.load(f)["recipes"]
    db.init()
    with db.write_tx() as conn:
        conn.execute("DELETE FROM recipes")
    for r in recipes:
        db.save(r["recipe"], recipe_id=r["id"], user="demo")
    log.info("demo: seeded %d recipes from %s", len(recipes), path)
