# TravelBuddy – NYC day planner

A one-day NYC itinerary built from Sam and Kailey's curated list. The planner is a slot template (breakfast or coffee, morning, lunch, afternoon, dinner, optional drinks) with clock windows, neighborhood clustering, and per-leg directions.

## On an iPhone

Add it to the home screen from Safari: Share → Add to Home Screen. It opens full screen, with the notch and home indicator padded, and the last generated day stays on the phone if the subway drops the signal. **Use my location** starts the first leg from where you are. Meal times do not move. Directions links open the Google Maps app when it is installed.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

```bash
npm test
npm run validate:places
```

## Environment

All keys are optional. The app plans, parses must-dos, and builds Google Maps links with none of them set.

| Variable | Purpose |
| --- | --- |
| `XAI_API_KEY` | Optional Grok calls. Server-side only. Base URL `https://api.x.ai/v1`. |
| `XAI_MODEL` | Model id. Defaults to `grok-4.7`. |
| `XAI_POLISH` | Set to `true` to let Grok rewrite descriptions. Titles and times are kept. |
| `XAI_SUGGESTIONS` | Set to `true` to let Grok fill a slot the trusted list cannot. Labeled **AI suggestion**. Off by default. |
| `GOOGLE_MAPS_API_KEY` | Optional live walking/transit times (Directions API). Server-side only. |
| `DATABASE_URL` | Prisma/SQLite, unused by the planner. |

Directions links are normal `https://www.google.com/maps/dir/?api=1` URLs. They do not need a key.

## How a day is built

`lib/planner.ts` replaces the old repair-loop planner.

- Pace is a stop count and a stay length. Chill is about 4 stops with longer visits, balanced 5–6, max 7–8.
- Lunch starts between 12:00 and 2:00. Dinner starts between 6:30 and 8:30. Drinks are after dinner. The day can run until about 11:00 PM.
- If the day is ahead of schedule, the gap is free time or another stop. Meals are not pulled earlier to fill it.
- A must-do with a clock time stays at that time. `8:00` with a dinner place is 8:00 PM. If the time can't be honored (you'd arrive late, or the place is closed), the time is kept and the itinerary shows a warning.
- Shows such as Hamilton are scheduled for about 2 hours 45 minutes. A 7:00 PM show keeps dinner earlier and says why.
- Every curated visit is checked against opening hours for the whole stay, including after times move. Unknown hours are allowed and called out by the validator.
- Stops are chosen in one or two adjacent neighborhoods. A thin focus such as Harlem can also use the next adjacent area (Upper West Side and Central Park) so the day can still be filled. Food places are not used as activities.
- Legs of about 20 minutes or less, and walks through the High Line, Central Park, the Brooklyn Bridge, or West Village streets, are walking. Longer legs name a subway or bus line. Each leg has a Maps directions link, and the day has a multi-stop link.

Must-dos are parsed without an API key (fuzzy match against the list, plus a small gazetteer for places people ask for that are not on the list, such as Carbone and Hamilton). Those are labeled as your must-do, not as a Sam or Kailey pick. Unmatched text is still placed on the day.

## Editing a place

`data/places-manhattan.json` is the list the planner uses (Manhattan only). `data/places-outer-boroughs.json` and `data/cut-places.json` are reference files and are not loaded. A place may have `locations[]`; the planner picks the branch nearest the previous stop. `status` of `closed` or `temporarily_closed` is kept in the file and left out of days. `placeholder: true` marks a coffee shop Sam has not tried; the planner can still schedule it, and prefers a non-placeholder coffee when the two are within a few minutes. `data/recommenders.json` maps recommender ids to a display name, a `type` (`person`, `friend`, or `publication`), an optional `url`, and a short bio.

Add a place by copying an existing object. Required fields:

- `id` — unique slug
- `name`
- `category` — primary category, also the first entry of `categories`
- `categories` — one or more of `breakfast`, `brunch`, `bakery`, `coffee`, `matcha`, `lunch`, `quick-bite`, `dinner`, `drinks`, `museum`, `landmark`, `park`, `activity`, `shopping`, `gallery`, `sweets`, `market`
- `neighborhood`, `area`
- `lat`, `lng` — the pin the planner routes with. If the pin is miles from the neighborhood name, the place is left out of automatic days.
- `duration_min`, `duration_max` — minutes
- `vibe_tags`, `energy_tags`
- `description`
- `hours` — seven weekdays, Sunday first. Each day is a list of `[openMinute, closeMinute]` from midnight. `null` means unknown. Do not invent hours.
- `outdoor`
- `recommended_by` — list of `{ "recommenderId": "sam" }` and an optional `note` quote. Default new places to both Sam and Kailey. AI-sourced placeholders are credited to `jonathan` until a real person is added.
- `source_refs` — optional. The publication ids a placeholder used to cite, kept after the card was pointed at Jonathan.
- `aliases` — optional other names for must-do matching, such as `"met museum"` for The Met.
- `note` — short comment for the place. Use `""` until there is one.
- `booking` — `walk_in`, `reservation_recommended`, `reservation_required`, `hard_to_book`, `tickets_required`, `no_reservations`, or `unknown`
- `booking_note`, `booking_url` — optional
- `placeholder` — optional. `true` for a coffee shop kept as coverage. Leave it off for a place someone has actually recommended.

To attribute a place to one person, leave only their id in `recommended_by`. To add a friend, a publication, or another placeholder, add them to `data/recommenders.json` (`id`, `displayName` or `name`, `type` of `person`, `friend`, `publication`, or `placeholder`, `bio`, optional `url`) and reference that id. The card says "Recommended by" plus the display name. Names are still not links. A must-do with an explicit time, including "at noon" or "at midnight", stays at that start time. "Met Museum" matches The Met through `aliases`, with no API key.

```bash
npm run validate:places
```

The script fails on missing coordinates, bad booking values, unknown recommender ids, and near-duplicate names at the same pin. Missing hours and shared coordinates are printed. `npm run validate:places -- --strict` also fails on those warnings.

The itinerary shows **Recommended by Sam & Kailey** (or Jonathan, for an AI-sourced placeholder) on every place card. The name is not a link yet. Each name is marked with `data-recommender-id` and `data-recommender-type` so a profile page can wrap it later. The morning slot is coffee when a coffee shop is open nearby, at that shop's nearest branch, and otherwise breakfast. Reservation-required, hard-to-book, and ticketed stops are listed under **Book ahead** when a must-do carries that booking.

## API

`POST /api/plan` with `{ city, date, vibes, pace, focusArea, locks }` returns `{ stops, warnings, mapsUrl, bookAhead, cluster }`. `POST /api/replan` adjusts one stop and returns the same shape. No model calls are made from the browser.
