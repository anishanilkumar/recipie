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

The rules exist three times: in Python for the MCP server
(`backend/recipie/cookable.py`), in TypeScript so the PWA's badge works
offline (`frontend/src/cookable.ts`), and in Kotlin for the Android app
(`android/.../logic/Cookable.kt`). All three are tested against
`shared/cookable-cases.json`. Change them together.

## The list

A recipe that reaches a device by sync (added by Claude, or on another phone)
is marked **New** and sits at the top until it's opened there. The first sync
of a fresh install marks nothing new.

**Recent** (the default) orders recipes by when they were last opened on this
device (a recipe never opened here goes by when it was last saved, so one
Claude just added shows near the top); **A–Z** is the other order. Opens are
kept on the device only and never synced, so each phone or browser has its
own order. Under the search, a row of tags (most-used first; "Kerala" and
"kerala", "make-ahead" and "make ahead" count as one) narrows the list to one
kind, and the Ready / Almost / Not tonight counts with it. The rules are in
`frontend/src/browse.ts` and Friday's `cook/logic/Browse.kt`; change them
together.

**Archive** on a recipe puts it away: it's kept, but leaves the list, the
counts and the tag row ("Show N archived" brings them back), and Claude's
`list_recipes`, `whats_cookable` and Mealplan's pickers leave it out. It's a
field on the recipe (`archived`), so it syncs and works offline like any
edit; Claude can do it with `archive_recipe`.

## Photos

Each recipe has two photo slots (`backend/recipie/photos.py`), kept outside
the recipe row so a photo never bumps a rev:

- **Own:** the plate. After cook mode, Friday's "Photograph the plate" logs the
  meal in Foodlog and also sends the photo here (plus a small thumbnail made on
  the phone). The first one stays; a later one replaces it only after
  "Remove plate photo".
- **Web stand-in:** until there's an own photo. **Photo** on a recipe searches
  [Openverse](https://openverse.org) (openly licensed pictures, mostly Flickr
  and Wikimedia Commons), starting from the title and shortening it until
  something turns up. The search runs on the phone or in the browser, not on
  the server: Openverse is behind a Cloudflare check that turns away data
  centres. The app sends the chosen thumbnail with Openverse's record of it,
  and the server makes the credit (title, creator, licence, source page) from
  that record; it's shown, linked, under the photo. Openverse's anonymous limit
  is 200 searches a day per device.

The own photo shows when there is one. A recipe with neither gets its first
letter in the list. `/api/photos` (with every sync) says which exist; each
picture's URL carries `?v=`, so phones and the service worker cache them for
good and they show offline. Files live in `RECIPIE_PHOTOS` (default: `photos/`
beside the database). Share links and the demo don't show or change photos;
Claude can't set them yet.

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
  exceptions to login are the share links: `/api/share/<slug>` (an event) and
  `/api/recipe-share/<slug>` (one recipe, read only).
  The Android app sends the same kind of session as a bearer token (see
  Android app).
- **Claude login:** the MCP server is an OAuth 2.1 protected resource. It
  verifies bearer tokens offline against the issuer's keys, using the verifier
  from [grocy-mcp](https://github.com/anishanilkumar/grocy-mcp).
- **Pantry:** read through grocy-mcp's Grocy client and cached for 60 seconds.
  If Grocy is down, the last snapshot is served and marked stale.

## Sharing a recipe

**Share** on a recipe's page makes a link, `/s/<title>-<secret>`, e.g.
`/s/nadan-chicken-curry-jsd45q`, to send to someone outside the household. It
opens without a login and shows that one recipe: the ingredients with a
servings stepper, the method, and cook mode. It is read only, shows the recipe
as it is now (later edits included), and leaves out the pantry links. Once
opened, the page keeps a copy and opens again with no signal.

A recipe has no link until one is made. "New link" replaces the secret (the old
link stops at once) and "Switch off" stops it; deleting the recipe does too.
The link lives in its own table (`shares.py`), so it never bumps the recipe's
rev. Claude can do the same with `share_recipe`, and Friday's Cook tab has the
same Share key on a recipe.

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

## Android app

The recipes are the **Cook** tab of Friday, the household's Android app
(`anishanilkumar/friday`), beside the food log and the inventory. It has the
recipe list with its lids, the recipe page, cook mode, the recipe editor, and
the household's side of events. The share page an event's link opens stays on
the web: the cooks have no app.

What it adds over the PWA: timers that ring on time with the screen off (an
AlarmManager alarm and an alarm-sound notification), the screen kept on in
cook mode, background sync of edits made without signal, Send link for an
event, and, with the inventory beside it, taking what a dish used out of
stock and putting what a recipe lacks on the shopping list.

**Sign-in** is Friday's one sign-in: the app signs in to Kanidm once (client
`friday`) and shows the ID token here at `/auth/app/friday`
(`backend/recipie/friday_sso.py`), which gives a session only when the token's
`friday_access` claim, set by Kanidm from the user's groups, includes
`recipes`. The session goes to `/api` as a bearer token. The older per-app
handoff (`/auth/login?app_challenge=`, `/auth/app/exchange`) is still there.

The app's tests run the cookability rules against `shared/cookable-cases.json`
here, so the rules exist three times (Python, TypeScript, Kotlin) and are held
to the same cases.

## Other services reading the book

Mealplan (`../mealplan`) plans meals from these recipes and keeps a copy.
It reads `GET /api/service/sync?since=N`, the same feed as `/api/sync`, with
a bearer token it gets from Kanidm by the client-credentials grant, as its
own OAuth2 client; nobody signs in (`backend/recipie/service.py`). Kanidm's
tokens for a confidential client are opaque, so Recipie asks Kanidm about
each one (introspection, as `recipie-web`), keeps the answer until the token
expires, and lets in only the clients it names. The token opens only that
GET: not `/api/sync`, not a write. Unconfigured, the endpoint answers 503.

A recipe can say what to do hours before cooking (`prep_ahead`: "Soak the
chickpeas", 8 hours): shown on the recipe page, edited in the editor (here
and in Friday's Cook, which sends it back with every save), set by Claude.
Mealplan reminds the evening before a day it's planned.

Every save or delete also sends an empty `recipes.changed` over NATS (when
`RECIPIE_NATS_URL` is set), so the copy is re-read at once rather than at
Mealplan's next 10-minute look.

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
| `RECIPIE_SERVICE_INTROSPECT_URL` / `RECIPIE_SERVICE_CLIENTS` | web | Service tokens (Mealplan) for `/api/service/sync`: Kanidm's introspection endpoint, and the client ids let in |
| `RECIPIE_NATS_URL` / `_NATS_USER` / `_NATS_PASSWORD_FILE` | both | `pantry.changed` in, `recipes.changed` out |
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
