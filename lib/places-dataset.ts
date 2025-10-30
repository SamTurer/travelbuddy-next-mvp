import rawPlaces from '../data/nyc-places.json';
import type { Place } from './planner';

type RawDataset = Place[] | Record<string, Place[]>;

function normalizeCategory(category?: string | null): string | undefined {
  if (!category) return undefined;
  const raw = category.trim();
  if (!raw) return undefined;
  const c = raw.toLowerCase();
  if (c === 'matcha') return 'coffee';
  if (c === 'gallery / showroom') return 'gallery';
  if (c === 'activity') return 'park';
  return raw;
}

function normalizePlace(place: Place & { [key: string]: any }): Place {
  const category = normalizeCategory(place.category) ?? place.category;
  const vibeTags = Array.isArray(place.vibe_tags) ? [...place.vibe_tags] : [];
  if (category && place.category && category.toLowerCase() !== place.category.toLowerCase()) {
    if (!vibeTags.includes(place.category)) {
      vibeTags.push(place.category);
    }
  }
  return {
    ...place,
    category,
    vibe_tags: vibeTags.length ? vibeTags : place.vibe_tags,
  };
}

function flattenPlacesDataset(raw: RawDataset): Place[] {
  if (Array.isArray(raw)) {
    return raw.map((place) => normalizePlace(place as Place & { [key: string]: any }));
  }

  if (raw && typeof raw === 'object') {
    const combined: Place[] = [];
    for (const value of Object.values(raw)) {
      if (Array.isArray(value)) {
        combined.push(
          ...value.map((place) => normalizePlace(place as Place & { [key: string]: any }))
        );
      }
    }
    if (combined.length) {
      return combined;
    }
  }

  throw new Error('Unexpected nyc-places dataset format');
}

export const placesDataset: Place[] = flattenPlacesDataset(rawPlaces as RawDataset);

export function getPlacesDataset(): Place[] {
  return placesDataset;
}
