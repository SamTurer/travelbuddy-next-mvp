#!/usr/bin/env node
/**
 * One-time script to enrich all places in nyc-places.json with Google Maps hours data
 * Run this once to populate hours, then commit the updated JSON file
 *
 * Usage: node scripts/enrich-hours.mjs
 */

import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// We'll fetch from Google Places API directly since importing from lib/ is complex
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_MAPS_API_KEY) {
  console.error('❌ Error: GOOGLE_MAPS_API_KEY environment variable not set');
  console.error('\nPlease add it to your .env.local file or set it in your environment:');
  console.error('  export GOOGLE_MAPS_API_KEY="your-key-here"');
  process.exit(1);
}

async function searchPlaceByName(name, city) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', `${name} ${city}`);
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY);
  url.searchParams.set('location', '40.7128,-74.0060'); // NYC coordinates
  url.searchParams.set('radius', '15000');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.results?.[0] || null;
}

async function getPlaceDetails(placeId) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'opening_hours,website,url');
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.result || null;
}

async function enrichPlace(place) {
  try {
    // Search for the place
    const searchResult = await searchPlaceByName(place.name, 'New York, NY');
    if (!searchResult) {
      return { success: false, reason: 'not found in search' };
    }

    // Extract basic info from search result
    if (searchResult.geometry?.location) {
      place.lat = searchResult.geometry.location.lat;
      place.lng = searchResult.geometry.location.lng;
    }

    if (searchResult.formatted_address && !place.location) {
      // Extract neighborhood from address
      const addressParts = searchResult.formatted_address.split(',');
      if (addressParts.length > 1) {
        const neighborhood = addressParts[addressParts.length - 3]?.trim();
        if (neighborhood && neighborhood !== 'New York') {
          place.neighborhood = place.neighborhood || neighborhood;
          place.location = place.location || searchResult.formatted_address;
        }
      }
    }

    // Get detailed info including hours
    if (searchResult.place_id) {
      const details = await getPlaceDetails(searchResult.place_id);

      if (details?.opening_hours) {
        place.hours = {
          openNow: details.opening_hours.open_now,
          weekdayText: details.opening_hours.weekday_text,
          periods: details.opening_hours.periods,
        };
      }

      if (details?.website && !place.url) {
        place.url = details.website;
      } else if (details?.url && !place.url) {
        place.url = details.url;
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

async function main() {
  const dataPath = join(__dirname, '../data/nyc-places.json');

  console.log('📖 Reading nyc-places.json...');
  const content = await fs.readFile(dataPath, 'utf-8');
  const places = JSON.parse(content);

  console.log(`✓ Found ${places.length} places`);

  const needsEnrichment = places.filter(p => !p.hours);
  console.log(`⚠️  ${needsEnrichment.length} places need hours enrichment`);

  if (needsEnrichment.length === 0) {
    console.log('✓ All places already have hours data!');
    return;
  }

  const estimatedMinutes = Math.ceil(needsEnrichment.length * 1.5 / 60);
  console.log(`\n🔄 Enriching ${needsEnrichment.length} places...`);
  console.log(`⏱️  Estimated time: ~${estimatedMinutes} minute${estimatedMinutes !== 1 ? 's' : ''}`);
  console.log(`💰 Estimated cost: ~$${(needsEnrichment.length * 0.049).toFixed(2)}\n`);

  let enriched = 0;
  let failed = 0;
  const failedPlaces = [];

  // Process in batches to avoid rate limits
  const BATCH_SIZE = 5;
  const DELAY_BETWEEN_BATCHES = 1000; // 1 second

  for (let i = 0; i < needsEnrichment.length; i += BATCH_SIZE) {
    const batch = needsEnrichment.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (place, batchIndex) => {
        const result = await enrichPlace(place);
        const index = i + batchIndex + 1;

        if (result.success) {
          enriched++;
          console.log(`  ✓ [${index}/${needsEnrichment.length}] ${place.name}`);
        } else {
          failed++;
          failedPlaces.push({ name: place.name, reason: result.reason });
          console.log(`  ✗ [${index}/${needsEnrichment.length}] ${place.name} - ${result.reason}`);
        }
      })
    );

    // Delay between batches to avoid rate limits
    if (i + BATCH_SIZE < needsEnrichment.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  console.log(`\n✓ Enrichment complete!`);
  console.log(`  - Successfully enriched: ${enriched} places`);
  console.log(`  - Failed: ${failed} places`);
  console.log(`  - Total with hours: ${places.filter(p => p.hours).length}/${places.length}`);

  if (failedPlaces.length > 0) {
    console.log(`\n⚠️  Failed places:`);
    failedPlaces.forEach(({ name, reason }) => {
      console.log(`    - ${name}: ${reason}`);
    });
  }

  console.log(`\n💾 Writing updated data to nyc-places.json...`);
  await fs.writeFile(dataPath, JSON.stringify(places, null, 2), 'utf-8');

  console.log(`✓ Done! All places data saved.`);
  console.log(`\n📝 Next steps:`);
  console.log(`  1. Review the changes: git diff data/nyc-places.json`);
  console.log(`  2. Commit the updated file: git add data/nyc-places.json`);
  console.log(`  3. git commit -m "Add Google Maps hours data to all places"`);
  console.log(`  4. Now user requests won't hit Google Maps API for hours! 🎉`);
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
