# TravelBuddy – Next.js MVP (NYC)

**What’s inside**
- Next.js 14 (App Router) + Tailwind
- API route: `POST /api/generate-itinerary` (rule-based planner on seed data in `app/data/nyc-places.json`)
- Prisma + SQLite (optional for later DB work)
- TypeScript + Zod validation

## Run locally

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Optional: set up SQLite + Prisma
```bash
cp .env.example .env
npx prisma generate
# npx prisma migrate dev --name init
# npm run seed
```

## Deploy (Vercel)
- Push to GitHub, import in Vercel (Next.js preset). No special config required.


---

## New: /api/replan (mood switch)
```http
POST /api/replan
{
  "city": "New York City",
  "date": "2025-10-12",
  "mood": "I'm Hungry",
  "currentStops": [{ "time":"10:00 AM","title":"...","location":"...","description":"..."}]
}
```
Returns an updated `stops[]`, replacing the next stop based on the mood.
(Current logic is simple; upgradeable to use distance/hours.)

## OpenAI integration (optional)
- Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4o-mini`) in your Vercel/locally.
- The planner keeps hard constraints but uses the LLM to **polish copy**.

Add to `.env.local`:
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

## Ingestion script for expert guides
Normalize CSV/JSON of local expert picks into `app/data/nyc-places.json`.

Examples in `scripts/templates/`.

Usage:
```bash
# CSV
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/ingest-guides.ts --input scripts/templates/guides-sample.csv

# JSON
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/ingest-guides.ts --input scripts/templates/guides-sample.json
```
This merges and de-dupes by `name + neighborhood`.
