# Recipie

A household recipe book that knows what's in the pantry. Recipes show a
coloured lid: **green** when everything's in, **yellow** when one or two minor
things are missing, **red** when a main ingredient is missing or more than two
things are. It's an installable PWA that works offline in the kitchen and syncs
when there's a connection. Claude can read and save recipes through an MCP
connector.

Live at **https://recipes.anishsheela.com** (login required).

## How the lid decides

Each ingredient has a role:

| Role | Meaning | If it's out |
|---|---|---|
| main | The dish doesn't exist without it (chicken in chicken curry) | Red |
| minor | Needed, but you can work around it (coconut oil, curry leaves) | Counts as one gap |
| optional | Garnish, "if you have it" | Never counts |

Ingredients can be linked to [Grocy](https://grocy.info) products (every pack
size: "White Onions, 2 kg" and "5 kg"; any one in stock counts) and list
substitutes (coconut oil, or ghee). Then:

- **Ready (green):** nothing missing. A minor ingredient covered by a substitute
  in stock is fine ("use ghee for the coconut oil").
- **Almost (yellow):** one or two gaps. A gap is a missing minor ingredient, or
  a main ingredient that only a substitute covers.
- **Not tonight (red):** a main ingredient is missing, or more than two gaps.
- **Can't tell (grey):** nothing blocks it, but a main ingredient isn't linked
  to Grocy, so it can't be checked.

Unlinked minor ingredients (salt, water) are assumed to be in the kitchen.

The rules exist twice: in Python for the MCP server
(`backend/recipie/cookable.py`) and in TypeScript so the badge works offline
(`frontend/src/cookable.ts`). Both are tested against
`shared/cookable-cases.json`. Change them together.

## Architecture

```
Phone (PWA)                      Server
┌──────────────────────┐         ┌───────────────────────────────────────┐
│ React + IndexedDB    │  /api   │ recipie-web  (FastAPI, :8770)         │
│ service worker       │ ──────▶ │   session login against Kanidm (OIDC) │
│ local edits → outbox │  sync   │   /api/sync  /api/pantry              │──┐
└──────────────────────┘         │                                       │  │ SQLite
                                 │ recipie-mcp  (FastMCP, :8771)         │──┤ recipie.db
Claude ── OAuth bearer ────────▶ │   save_recipe, whats_cookable, …      │  │
                                 └───────────────┬───────────────────────┘  │
                                                 │ stock (read only)        │
                                                 ▼                          │
                                               Grocy                        │
```

- **Sync:** every recipe has a `rev` (edits to it) and a global `seq` (change
  feed). The PWA pushes dirty recipes with the `rev` they were based on, then
  pulls everything after its cursor. If the server moved on meanwhile (usually
  because Claude edited the recipe), the server's version keeps the recipe and
  the phone's edit is saved as a copy titled "(my edit)". Nothing typed in the
  kitchen is lost. Deletes are tombstones, so they reach phones that were
  offline.
- **Browser login:** the backend is a confidential OIDC client and keeps
  sessions server-side (30 days, sliding). The PWA holds only an HttpOnly
  cookie, never a token. Writes need an `X-Recipie: 1` header (CSRF). The
  one exception to login is `/api/share/<slug>`, an event's share link.
- **Claude login:** the MCP server is an OAuth 2.1 protected resource. It
  verifies bearer tokens offline against the issuer's keys, using the verifier
  from [grocy-mcp](https://github.com/anishanilkumar/grocy-mcp).
- **Pantry:** read through grocy-mcp's Grocy client and cached for 60 seconds.
  If Grocy is down, the last snapshot is served and marked stale.

## Events

A menu cooked for other people, over one or more days, at `/events`. Each day
has a headcount; each dish can link a recipe, be plain text with typed-in
ingredients, or be marked "made ahead" (it adds nothing to the list).

- **Share link:** `/e/<title>-<secret>`, e.g. `/e/lunch-menu-migrant-kitchen-yj47sf`.
  It opens without a login: the six-character secret is the key. "New link"
  changes only the secret (the old one stops at once), "Switch off" stops it
  altogether, and the words can be renamed. Changing the event's title doesn't
  change the link.
- **Who can do what:** anyone with the link sees the menu and the linked
  recipes (scaled to the day), ticks off the shopping, adds items, marks
  dishes done, and leaves notes on a dish, a shopping line or the board. Only
  the household changes the menu. Visitors' actions live in side tables
  (`events.py`), so they never bump the menu's rev or cause a conflict.
- **Shopping list:** worked out on the server (`shopping.py`): each linked
  recipe is scaled from its servings to the day's headcount, and lines with
  the same name and unit are summed across dishes and days (kg and l fold into
  g and ml). Ticks are keyed by name and unit, so they survive menu edits.
  The household can hide lines like salt. Grocy is not used: events are
  cooked in another kitchen.
- **Offline:** the share page keeps its last copy and an outbox in
  localStorage, so it opens and takes ticks with no signal, and sends them in
  order when it's back. While open it polls one number (`version`) every 8 s.

Claude can create and edit events too (`save_event`, `get_event`,
`list_events`, `share_event`): paste a menu and ask it to save it as an event.

## Adding the connector in Claude

Settings → Connectors → Add custom connector:

```
URL:        https://recipes-mcp.anishsheela.com/mcp
Client ID:  claude-recipes
Secret:     leave blank (public PKCE client)
```

Then ask things like "save this recipe to Recipie", "what can I cook tonight?",
or "link the ingredients of the egg roast to the pantry". Claude only saves when
asked.

## Development

```bash
# Backend
cd backend
uv venv .venv && uv pip install -e '.[dev]'
.venv/bin/pytest
RECIPIE_DB=dev.db .venv/bin/python dev/seed.py
RECIPIE_DB=dev.db RECIPIE_DEV_USER=me RECIPIE_PANTRY_FILE=dev/pantry.json \
  .venv/bin/python -m recipie web            # :8770
RECIPIE_DB=dev.db RECIPIE_PANTRY_FILE=dev/pantry.json \
  .venv/bin/python -m recipie mcp --no-auth  # :8771/mcp

# Frontend (proxies /api and /auth to :8770)
cd frontend
npm install
npm run dev     # http://localhost:5173
npm test
```

`RECIPIE_DEV_USER` skips login and refuses to start with an https public URL.
`RECIPIE_PANTRY_FILE` replaces Grocy with a JSON file.

## Configuration

| Variable | Used by | |
|---|---|---|
| `RECIPIE_DB` | both | SQLite path |
| `RECIPIE_PUBLIC_URL` | web | e.g. `https://recipes.anishsheela.com` |
| `RECIPIE_OIDC_ISSUER` / `_CLIENT_ID` / `_CLIENT_SECRET` | web | Browser login |
| `RECIPIE_MCP_OIDC_ISSUER` / `_JWKS_URI` / `_AUDIENCE` / `_SCOPES` | mcp | Bearer token checks |
| `GROCY_API_URL` / `GROCY_API_KEY` | both | Pantry reads |

## Deploying

The server side (systemd units, nginx vhosts, Kanidm clients, backups) is
declared in the NixOS configuration, not in this repo. Code ships with:

```bash
cp .deploy.env.example .deploy.env   # once; fill in the host
./deploy.sh
```

It runs the tests, builds the PWA, rsyncs the backend package and the build,
and restarts `recipie-web` and `recipie-mcp`.
