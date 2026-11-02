# Fuel & Transport

Official **IPT** fuel prices (UNL 95, UNL 98, Diesel, Gas/LPG) and the **fuel-indexed daily
transportation rate**, month by month from October 2026, with every calculation shown.
Vanilla JS front end · Node.js back end · PostgreSQL · Docker · Vercel-ready. One folder.

## The rule

| | |
|---|---|
| Old terms (before Oct 2026) | fixed **450,000 L.L.** / day |
| New terms (from Oct 2026) | **5 L** of UNL 95 per day, indexed to the average official price, kept between **500,000 and 800,000 L.L.** / day |

```
average price / 20 L = (sum of the price tables) ÷ (number of tables)   — each table counts once
price of 1 litre     = average ÷ 20
daily rate           = 5 × price of 1 litre → rounded to 1,000 → kept within 500,000–800,000
transportation       = days worked × daily rate  (× employees)
```

The table already in force on the first day of the period is the first entry; if no new table comes
out, that old price simply stands again. The current month is averaged up to today and keeps updating when IPT publishes a new table;
a future month is an estimate from the latest table. Constants live in `lib/rules.js`.

October 2026 has split: days before 22 Oct at **450,000** + days from 22 Oct at the fuel rate (**500K – 800K**).

Check: tables of 20 Oct (2,739,000) and 23 Oct (2,686,000) → average 2,712,500 → 678,125 → **678,000 / day** → 26 days = **17,628,000 L.L.**

## October calculator (side card)

Pick the date the new terms start (chips = every October price change; default = whole month, first table **2 Oct**).
Days before it, from **1 Oct**, stay at **450,000**; days from it use the fuel rate, averaged from that date until today
(rate kept between 500K and 800K). Sundays are excluded and a pay month is capped at 26 days (the extra day comes off the last period); days can be edited.
`GET /api/period?from=2026-10-09`. Example: from 9 Oct → 6 prices → 684,000/day; 7×450,000 + 19×684,000 = 16,146,000 (26 days).

The Fuel Price History table has an **Export to Excel** panel beside it (date range → .xlsx).

## Run it

**Docker (recommended)**
```bash
docker compose up --build        # → http://localhost:3000
```

**Without Docker** (Node 18+)
```bash
npm install
npm start                        # works without a database too
```
Set `DATABASE_URL` (see `.env.example`) to have new prices saved.

**Tests** `npm test` (add `TEST_DATABASE_URL=postgresql://…` to include the PostgreSQL test)

## Deploy on Vercel

1. Create a free Postgres on **Neon** and copy its connection string.
2. Push this folder to GitHub → *Import* it in Vercel (no build settings needed — `vercel.json` has them).
3. Add the environment variable `DATABASE_URL` = the Neon string → **Deploy**.

Tables are created automatically on first request.

## How prices stay current

- Every page load re-reads the IPT page if the saved prices are older than 30 minutes (the server
  fetches it; browsers never do). Each new table is stored under its own date in `fuel_price_history`.
- **Update from IPT** button = read it now (max once a minute).
- Vercel also runs `/api/refresh` once a day (cron, free-plan limit). Docker re-reads every 30 min.
- If IPT is unreachable the last saved prices are used and the badge says **Saved** instead of **Live**.
- History before today is seeded in `lib/history.js` (Jun 29 → Oct 30, 2026, from your project).

## Files

```
public/        index.html · style.css · app.js          the website
api/           summary · prices · rate · refresh · health   Vercel functions
lib/           rules (the maths) · ipt (reads IPT) · history · db · service · http
server.js      Docker/local server — serves public/ and the same api/ files
db/schema.sql  tables for docker-compose
test/          rule, parser, API and PostgreSQL tests
```

API: `GET /api/summary?month=2026-10&days=26&employees=1` returns everything the page shows.

## Notes
- Petrol/diesel are quoted per 20 L; LPG per 10 kg cylinder.
- Prices are only used to set the rate; they are not meant for the payslip.

## "Get full access" ad & the no-ad link

- **Main link** `https://fuel-transport-lebanon.vercel.app` → the first time a visitor opens it, a 30-second clock
  starts. When it ends, a popup shows Rony's photo, WhatsApp (+961 70 953 864) and LinkedIn. It cannot be closed.
  Refreshing does not restart the clock: after the 30 seconds the ad shows immediately on every load.
  Clearing the browser data gives a fresh 30 seconds. Change the delay with `FIRST_DELAY_MS` at the top of
  `public/promo.js` (and bump the `?v=` number on the script tag in `index.html` so browsers fetch the new file).
- **Full-access link** (no ad) → currently `https://fuel-transport-lebanon.vercel.app/adminstrator`.

### Change the full-access link (do this from time to time)

The link lives in **one place only: `vercel.json` → `rewrites`**. It is not written anywhere in the
page's code, so users can't discover it.

```json
"rewrites": [
  { "source": "/fullaccesstopage", "destination": "/index.html" }
]
```

1. Replace `/fullaccesstopage` with the new word, e.g. `/fullaccess`, `/mainentrance`, `/k7-nov26`.
2. Commit & push → Vercel redeploys in ~1 minute.
3. The old link now shows "Not found"; send the new link to paying users.

To keep several links working at once (e.g. a grace week for old users), add more lines:

```json
"rewrites": [
  { "source": "/mainentrance", "destination": "/index.html" },
  { "source": "/fullaccess",   "destination": "/index.html" }
]
```

The Docker/local server reads the same list from `vercel.json`, so nothing else needs changing.
Note: this hides an ad, it is not a password — anyone who is given the link can share it, which is
why rotating it regularly matters.