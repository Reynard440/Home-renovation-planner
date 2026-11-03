# Budget Home Renovations

A strategic savings planner for home renovation projects. "Save R5,000 a month" isn't a plan — this app tells you **exactly how much to save, for which project, and when each upgrade becomes affordable**, accounting for interest on your savings and rising building costs.

## What it does

| Question | Where |
|---|---|
| What does this project actually cost? | **Project → Cost items** — labour, materials, equipment hire, permits/CoCs, delivery & rubble removal, fixtures… with quantity × unit cost, quote status and a contingency buffer. |
| If I save R X/month, when can I start? | **Project → How long will it take?** — slider + quick scenarios (R500 → R15,000/month). |
| I want it done by date Y — what must I save? | **Project → What must I save to hit my date?** — required monthly amount, inflation cost of waiting, interest earned. |
| I have one budget and many projects — how do I split it? | **Savings plan** — compares *Priority first*, *Quick wins* and *All at once* strategies with a funding timeline. |
| Are my target dates realistic? | **Dashboard / Savings plan** — gap analysis: required R/month vs. what you actually save. |
| Am I actually saving? | **Project → Savings deposits** — log real deposits/withdrawals; progress bars update. |

## The maths

- Annual rates → effective monthly rates: `(1 + a)^(1/12) − 1`.
- Deposits at month-end (ordinary annuity). Required monthly saving:
  `PMT = (Cost·(1+g)^n − Saved·(1+r)^n) · r / ((1+r)^n − 1)`
  where `r` = monthly savings interest, `g` = monthly cost inflation, `n` = months.
- *Time to afford* is simulated month by month until savings ≥ inflated cost (capped at 50 years → "Never").
- **Still to save** = (unpaid items + contingency) − deposits for that project. Items marked *paid* are sunk cost.
- Projects *In progress* or *Done* are excluded from the plan.

All of this lives in [`js/finance.js`](js/finance.js) — pure functions, no DOM — covered by `tests/finance.test.mjs`.

## Data storage

Data is stored in your browser's `localStorage` — no server, no account, no cost, works offline once loaded.
**Trade-off:** it lives in one browser on one device. Clearing site data deletes it. Use **Settings → Export backup** regularly; **Import backup** restores it (and moves it between devices). CSV export of all items is available for spreadsheets.

## Run locally

```bash
npm start        # serves on http://localhost:8080 (python3 http.server)
npm test         # runs the finance engine tests (Node 20+)
```

No build step, no dependencies.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` runs the tests and, on every push to `main`, deploys the site.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Structure

```
index.html            app shell
css/styles.css        design tokens, light + dark mode, responsive
js/finance.js         pure calculation engine (tested)
js/store.js           persistence, schema validation, import/export, example data
js/app.js             views, router, modals, SVG charts
tests/                node:test unit tests
```
