import { planDay, summarizeItinerary } from '@/lib/planner';

async function main() {
  const itinerary = await planDay({
    city: 'New York City',
    date: '2026-11-14',
    vibes: ['local'],
    pace: 'balanced',
    focusArea: null,
    locks: [],
  });
  console.log(summarizeItinerary(itinerary));
}

main();
