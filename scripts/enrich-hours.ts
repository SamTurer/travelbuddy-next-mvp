#!/usr/bin/env node
/**
 * One-time script to enrich all places in nyc-places.json with Google Maps hours data
 * Run this once to populate hours, then commit the updated JSON file
 *
 * Usage: npx tsx scripts/enrich-hours.ts
 */

import fs from 'fs/promises';
import path from 'path';
import { verifyPlaceHoursByName } from '../lib/providers/hours.js';

type Place = {
  name: string;
  category?: string;
  neighborhood?: string;
  duration_min?: number;
  duration_max?: number;
  vibe_tags?: string[];
  energy_tags?: string[];
  description?: string;
  location?: string;
  url?: string;
  lat?: number;
  lng?: number;
  hours?: any;
};

async function main() {
  const dataPath = path.join(__dirname, '../data/nyc-places.json');

  console.log('📖 Reading nyc-places.json...');
  const content = await fs.readFile(dataPath, 'utf-8');
  const places: Place[] = JSON.parse(content);

  console.log(`✓ Found ${places.length} places`);

  const needsEnrichment = places.filter(p => !p.hours);
  console.log(`⚠️  ${needsEnrichment.length} places need hours enrichment`);

  if (needsEnrichment.length === 0) {
    console.log('✓ All places already have hours data!');
    return;
  }

  console.log(`\n🔄 Enriching ${needsEnrichment.length} places...`);
  console.log(`⏱️  Estimated time: ~${Math.ceil(needsEnrichment.length * 1.5 / 60)} minutes\n`);

  let enriched = 0;
  let failed = 0;

  // Process in batches to avoid rate limits
  const BATCH_SIZE = 10;
  const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds

  for (let i = 0; i < needsEnrichment.length; i += BATCH_SIZE) {
    const batch = needsEnrichment.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (place) => {
        try {
          const { hours, website, bestBranch } = await verifyPlaceHoursByName(place.name, 'New York, NY');

          if (hours && (hours.weekdayText?.length || hours.periods?.length || typeof hours.openNow === 'boolean')) {
            place.hours = hours;
            enriched++;
          }

          if (website && !place.url) {
            place.url = website;
          }

          if (bestBranch) {
            if (!place.neighborhood && bestBranch.neighborhood) {
              place.neighborhood = bestBranch.neighborhood;
            }
            if (!place.location && (bestBranch.address || bestBranch.neighborhood)) {
              place.location = bestBranch.address || bestBranch.neighborhood;
            }
            if (bestBranch.lat != null && bestBranch.lng != null) {
              place.lat = bestBranch.lat;
              place.lng = bestBranch.lng;
            }
          }

          console.log(`  ✓ [${i + batch.indexOf(place) + 1}/${needsEnrichment.length}] ${place.name}`);
        } catch (error) {
          failed++;
          console.log(`  ✗ [${i + batch.indexOf(place) + 1}/${needsEnrichment.length}] ${place.name} - ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      })
    );

    // Delay between batches to avoid rate limits
    if (i + BATCH_SIZE < needsEnrichment.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  console.log(`\n✓ Enrichment complete!`);
  console.log(`  - Enriched: ${enriched} places`);
  console.log(`  - Failed: ${failed} places`);
  console.log(`  - Total with hours: ${places.filter(p => p.hours).length}/${places.length}`);

  console.log(`\n💾 Writing updated data to nyc-places.json...`);
  await fs.writeFile(dataPath, JSON.stringify(places, null, 2), 'utf-8');

  console.log(`✓ Done! All places data saved.`);
  console.log(`\n📝 Next steps:`);
  console.log(`  1. Review the changes in git diff`);
  console.log(`  2. Commit the updated nyc-places.json file`);
  console.log(`  3. Now user requests won't hit Google Maps API for hours!`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
