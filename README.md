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
average price / 20 L = Σ (price × days in force) ÷ days      (calendar days of the pay month)
price of 1 litre     = average ÷ 20
daily rate           = 5 × price of 1 litre → rounded to 1,000 → kept within 500,000–800,000
transportation       = days worked × daily rate  (× employees)
```

The current month is averaged up to today and keeps updating when IPT publishes a new table;
a future month is an estimate from the latest table. Constants live in `lib/rules.js`.

October 2026 has split: days before 22 Oct at **450,000** + days from 22 Oct at the fuel rate (**400K – 800K**).

Check: October 2026 to 22 Oct → average 2,798,591 → 699,648 → **700,000 / day** → 26 days = **18,200,000 L.L.**

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
- History before today is seeded in `lib/history.js` (Jun 29 → Oct 20, 2026, from your project).

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
