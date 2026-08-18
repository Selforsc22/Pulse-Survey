# Squeak Easy

A map of cheese curds. Anyone can rate the squeak. No accounts, no logins.

Static site on GitHub Pages, plus one Cloudflare Worker with a D1 database that
accepts scores, blocks floods, and returns averages.

## Run it

No build step. Serve the repo root over HTTP — `file://` will not work, because
`app.js` is an ES module and it fetches `places.json`.

```
python3 -m http.server 8000
# then open http://127.0.0.1:8000/
```

## Test

```
npm test        # node --test
```

14 cases covering `map-logic.js`, which holds every pure function the page needs:
`filterPlaces`, `parseFilters`, `serializeFilters`, `boundsOf`, `formatScore`,
`markerState`, `sortPlaces`. No Leaflet, no DOM, no network. `package.json` exists
only for that script and has no dependencies.

## Files

```
index.html        style.css         app.js
map-logic.js      places.json       .nojekyll
test/map-logic.test.js              package.json
worker/index.js   worker/schema.sql worker/wrangler.toml
README.md
```

`map-logic.js` is split out because it has to run in Node for the tests and in the
browser for the page. `app.js` holds everything impure: DOM, Leaflet, localStorage,
network.

## Data

`places.json` is a flat array. `lat` and `lng` to 5 decimals, geocoded by hand.
`note` is 140 characters maximum. `id` is the slug the Worker validates against and
never changes once published.

Three sample records ship so the page runs on first load. The addresses are
deliberately fake.

**When you add places, update the `PLACE_IDS` array in `worker/index.js`:**

```
node -e "console.log(JSON.stringify(require('./places.json').map(p=>p.id),null,2))"
```

## Deploy

### Site

1. Site files at repo root, branch `main`, Pages source `main` / `(root)`.
2. `.nojekyll` is already there.
3. Relative paths only — project sites live at `/squeak-easy/`, so a leading `/`
   breaks every asset.

### Worker

```
cd worker
wrangler d1 create squeakeasy          # paste database_id into wrangler.toml
wrangler d1 execute squeakeasy --file=schema.sql
wrangler secret put SALT               # any long random string
wrangler secret put TURNSTILE_SECRET   # from the Turnstile dashboard
wrangler deploy
```

Then set `ALLOWED_ORIGIN` in `wrangler.toml` to your Pages origin, and put the
Worker URL and the Turnstile **site** key in the `CONFIG` object at the top of
`app.js`. Site keys are public. Secrets are not, and none are in this repo.

Add a Cloudflare Rate Limiting rule on the Worker route as the outer layer.

### Endpoints

- `GET /scores` — `{ "<place_id>": { "avg": 4.2, "count": 37 } }`, cached 60s.
- `POST /scores` — `{ placeId, score, turnstileToken }`, returns the updated
  `{ avg, count }`.

Server-side validation, in order: Turnstile token, known `placeId`, integer score
1–5, body under 1KB. Rate limits are 1 per place per IP per 24h and 15 per IP per
24h, both enforced with one `SELECT COUNT(*)` before the insert. `ip_hash` is
`SHA-256(CF-Connecting-IP + SALT)`; the raw IP is never stored and the hash is
never returned. CORS allows only the Pages origin, not `*`.

The browser keeps a `localStorage` note of what it rated so the UI can answer
instantly. That is a courtesy. The Worker is the control.

## Palette

| Token | Hex | Use |
|---|---|---|
| `--cream` | `#FAF3D7` | Page, map, and popup background |
| `--ecru` | `#C8B891` | 1px borders, dividers, disabled state |
| `--antwerp` | `#24476B` | Headings, links, default marker fill, focus ring |
| `--nile` | `#A3C4CC` | Hover fill, active filter chip, selected marker |
| `--ink` | `#141414` | Body text |

Cream is the only background. Nile is a fill, never text on cream — it measures
1.67:1. Ink on cream is 16.55:1 and antwerp on cream is 8.62:1, both past 4.5:1.

## Icons

Icons follow the [Flaticon graphic design set](https://www.flaticon.com/free-icons/graphic-design).
One icon per meaning — search, location, directions, price — reused everywhere
that meaning appears. They are currently inline `<symbol>` elements in
`index.html` rather than downloaded files; see "What is not built" below.

## What is not built

Skipped on purpose until traffic makes one of them a problem: marker clustering,
photos, comments, editing or deleting a score, a moderation queue, sorting by
score, analytics, and a submit-a-new-place form.

Shortcuts taken during the build are marked with `ponytail:` comments at the spot
that would need the work, each with its upgrade path.
