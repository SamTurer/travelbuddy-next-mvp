# Scripts

## enrich-hours.ts

**One-time script to populate Google Maps hours data for all places in `nyc-places.json`**

### Why?

Without pre-populated hours, the app would make expensive Google Maps API calls on **every user request**:
- 339 places × 2 API calls (Text Search + Place Details) = ~678 API calls
- Cost: ~$16.61 per itinerary generation
- This would get very expensive, very quickly! 💸

### Solution

Run this script **once** to enrich all places with hours data, then commit the updated JSON file. After that, user requests won't need to hit the Google Maps API for hours.

### Prerequisites

1. Set up your Google Maps API key in `.env.local`:
   ```bash
   GOOGLE_MAPS_API_KEY=your_key_here
   ```

2. Enable the following APIs in Google Cloud Console:
   - Places API
   - Geocoding API

### Usage

```bash
# Make sure GOOGLE_MAPS_API_KEY is set in .env.local or export it:
export GOOGLE_MAPS_API_KEY="your-key-here"

# Run the enrichment script
node scripts/enrich-hours.mjs
```

The script will:
1. Read all 339 places from `data/nyc-places.json`
2. For each place without hours data:
   - Call Google Places Text Search API
   - Call Google Places Details API
   - Extract opening hours, coordinates, and website
3. Save the enriched data back to `nyc-places.json`

### Cost Estimate

- **One-time cost**: ~$16.61 (for 339 places)
- **Ongoing cost after enrichment**: $0 (hours data is pre-populated)

### After Running

1. Review the changes: `git diff data/nyc-places.json`
2. Commit the updated file: `git add data/nyc-places.json && git commit -m "Add Google Maps hours data to all places"`
3. Deploy to production - users will never hit the API for hours! ✅

### Live Enrichment (Not Recommended for Production)

If you want to test live enrichment during development, set:
```bash
ENABLE_LIVE_HOURS_ENRICHMENT=true
```

**WARNING**: This should NEVER be enabled in production as it will make expensive API calls on every user request.
