import { plan } from '@/lib/planner';
import { getPlacesDataset } from '@/lib/places-dataset';

async function main() {
  const stops = await plan(
    {
      city: 'New York City',
      date: '2024-10-10',
      vibes: [],
      pace: 'balanced',
      focusArea: null,
      locks: []
    } as any,
    getPlacesDataset()
  );
  console.log(stops.slice(0, 5));
}

main();
