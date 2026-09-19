# Jeedle — Football Decision Playground

A [Metademic.org](https://metademic.org) experiment that ranks today's football
fixtures so you can pick what's worth watching. Each fixture is scored by
TypeSafe AI's **Jev** model on four dimensions — *excitement*, *stakes*,
*rivalry*, and *atmosphere* — combined with a derby / no‑derby judgement into a
single composite you can tune to taste.

The app also ships a fully offline **Needle 3** heuristic judge so the
playground keeps working when no TypeSafe API key is configured, and uses the
same model as a semantic news‑search backend.

![Jeedle](public/jeedle-mark.svg)

## Features

- **Live fixture feed** for Europe's top competitions, sourced from
  [football-data.org](https://www.football-data.org/) (PL, PD, BL1, SA, FL1, CL,
  ELC, PPL, EC, ERED, WC, ECL, EL — configurable).
- **Tunable scoring weights** for the four Jev dimensions, plus persona knobs
  (top‑leagues bias, live‑only).
- **Composite ranking** with a *Must watch / Recommended / Skip* tag derived
  from a code‑side threshold — recommendations never live inside the prompt.
- **Two interchangeable judges** selectable from the UI:
  - **Auto** — call Jev, fall back to Needle 3 on any failure.
  - **Jev** — always call TypeSafe; fail loudly if the upstream is down.
  - **Needle 3** — pure offline heuristic (derby dictionary + league
    prestige); no API key required.
- **Semantic news search** — Jev ranks candidate headlines against your query
  as a per‑headline yes/no relevance judgement, falling back to Needle 3's
  substring matcher.
- **Team logos** for ~400 clubs across 23 leagues, resolved from
  `public/logos/` via a generated manifest (no hard‑coded list in the bundle).
- **Theme presets** — Violet, Ember, Ocean, Rose, Forest, Sunset; choice is
  persisted in `localStorage`.

## Stack

- [Next.js 14](https://nextjs.org/) (App Router, Node.js runtime)
- React 18 + TypeScript
- [`@typesafe-ai/sdk`](https://docs.typesafe.ai/) for the Jev client
- `football-data.org` v4 REST API for fixtures

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure environment variables

Create a `.env.local` in the repo root:

```bash
# Required for live fixtures (free tier works, register at football-data.org)
FOOTBALL_DATA_API_KEY=your-x-auth-token

# Optional — enables the Jev backend for ranking + semantic news search
TYPESAFE_API_KEY=your-typesafe-api-key
```

Without `TYPESAFE_API_KEY`, the app silently uses the **Needle 3** judge and
search backend. Without `FOOTBALL_DATA_API_KEY`, the `/api/matches` and
`/api/decide` routes will return a clear 503 with an actionable hint.

### 3. Run the dev server

```bash
npm run dev          # http://localhost:3000
```

### 4. Build for production

```bash
npm run build
npm start
```

## API surface

All routes are Next.js Route Handlers under `app/api/`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/matches` | `GET` | List today's matches for given competitions / date window. |
| `/api/decide` | `POST` | Judge a window of fixtures and return ranked decisions. |
| `/api/news` | `GET` | Default or query‑driven headline list (Jev‑ranked when keyed). |
| `/api/team-manifest` | `GET` | Folder/basename index for the team‑logo resolver. |

Example ranking call:

```bash
curl -X POST http://localhost:3000/api/decide \
  -H 'content-type: application/json' \
  -d '{
    "competitions": "PL,PD,BL1,SA,FL1,CL",
    "limit": 6,
    "prefs": {
      "backend": "auto",
      "weights": { "excitement": 0.4, "stakes": 0.25, "rivalry": 0.2, "atmosphere": 0.15 },
      "preferTopLeagues": true,
      "preferLive": false
    }
  }'
```

## How Jev decides

For every candidate fixture, Jev answers **five** independent questions over the
same `state` (the trimmed match summary + viewer prefs), so they run in
parallel and never see each other's answers:

1. **Score** — Excitement (5‑point scale)
2. **Score** — Stakes (5‑point scale)
3. **Score** — Rivalry (5‑point scale)
4. **Score** — Atmosphere (5‑point scale)
5. **Noul** — Is this a recognized derby? (0..1)

Code then:

- normalizes the four scores to 0..1,
- combines them with the slider weights you set in the UI,
- blends the rivalry score with the derby noul (`0.85 × rivalry + 0.15 × isDerby`),
- averages the score confidences into a workflow certainty,
- maps `(composite, confidence)` to a watch recommendation:
  - `composite ≥ 0.7 && confidence ≥ 0.45` → **Must watch**
  - `composite ≥ 0.5` → **Recommended**
  - otherwise → **Skip**

Keeping the thresholds, weighting, and blend in code (rather than in the
prompt) means the recommendation stays auditable and the model stays
reusable.

## Needle 3 (offline judge)

When `TYPESAFE_API_KEY` is missing or the upstream errors, the same composite
is produced by a deterministic heuristic in `lib/typesafe.ts`:

- a packed league‑prestige table (`PL`, `PD`, `BL1`, `SA`, `FL1`, `ERED`,
  `PPL`, `CL`, `EL`, `ECL`, `WC`, `EC`),
- a derby dictionary for the biggest rivalries,
- matchday‑aware stakes (cup knockouts, late season),
- live‑flag boost for atmosphere.

The headline corpus used by `/api/news` lives in `needle3.cact`. If the file
is missing, the route falls back to a curated set of publisher‑linked
headlines so the UI never goes empty.

## Project layout

```
app/
  layout.tsx              # global metadata + html shell
  page.tsx                # the playground UI (hero, fixtures, rankings, panels)
  globals.css             # design tokens, themes, layout primitives
  api/
    decide/route.ts       # POST: judge fixtures, return ranked decisions
    matches/route.ts      # GET:  fetch fixtures for the given window
    news/route.ts         # GET:  default or query‑driven headlines
    team-manifest/route.ts# GET:  logo index for the resolver
lib/
  typesafe.ts             # Jev + Needle 3 judges, news search, dispatcher
  football.ts             # football-data.org client + types
  teamLogos.ts            # client‑side logo resolver (uses team-manifest)
  teamLogosCore.ts        # normalization + fallback swatch helpers
public/
  logos/                  # PNG crests, grouped by league folder
  hero.mp4                # hero portrait loop
  jeedle-mark.svg         # brand mark
needle3.cact              # optional packed data table for the local judge
```

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `FOOTBALL_DATA_API_KEY` | Yes for live fixtures | `X-Auth-Token` header for football-data.org v4. |
| `TYPESAFE_API_KEY` | Optional | Enables the Jev backend for `/api/decide` and `/api/news?q=…`. When unset, Needle 3 is used automatically. |

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server on port 3000. |
| `npm run build` | Production build. |
| `npm start` | Run the production build. |
| `npm run lint` | `next lint`. |

## Acknowledgements

- TypeSafe AI for the [Jev SDK](https://docs.typesafe.ai/) and the
  *parallel independent questions over the same state* pattern that powers the
  judge.
- [football-data.org](https://www.football-data.org/) for the free open
  football data API.
- The team logos in `public/logos/` belong to their respective clubs and
  competitions; they're used here for a non‑commercial demo.

---

A Metademic project — *All Fixtures Ranked*.
