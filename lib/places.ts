import rawPlaces from '../data/places-manhattan.json';
import type { BookingKind } from './booking';
import { resolveRecommendations, type RecommendationRef, type RecommendedByPerson } from './recommenders';

export type PlaceStatus = 'open' | 'closed' | 'temporarily_closed' | 'unverified';

/** One branch of a place. A place with no locations array is treated as a single branch. */
export type PlaceLocation = {
  id: string;
  label: string;
  address?: string | null;
  lat: number;
  lng: number;
  neighborhood?: string;
  hours: number[][][] | null;
  hours_source?: string;
  coord_source?: string;
  booking_url?: string;
};

export { BOOKING_KINDS, BOOKING_LABEL, BOOK_AHEAD_KINDS, isBookingKind } from './booking';
export type { BookingKind } from './booking';

/**
 * A place on Sam & Kailey's curated list.
 * Hours are per weekday, Sunday = 0 (same as Date.getDay()). Each day is a list
 * of [openMinute, closeMinute] windows from midnight. Null hours means unknown.
 */
export type Place = {
  id: string;
  name: string;
  category: string;
  categories: string[];
  neighborhood: string;
  area: string;
  lat: number;
  lng: number;
  duration_min: number;
  duration_max: number;
  vibe_tags: string[];
  energy_tags: string[];
  description: string;
  hours: number[][][] | null;
  hours_wednesday_inferred?: boolean;
  hours_approximate?: boolean;
  outdoor?: boolean;
  recommended_by: RecommendationRef[];
  /**
   * Publication or other ids that originally sourced a placeholder place.
   * The card credits `recommended_by` (Jonathan, until a real person is added).
   */
  source_refs?: RecommendationRef[];
  /** Other names people type, such as "Met Museum" for The Met. Matching ignores case and "the". */
  aliases?: string[];
  /** Editor comment from Sam, Kailey, or a friend. Empty until they fill it in. */
  note: string;
  booking: BookingKind;
  booking_note?: string;
  booking_url?: string;
  url?: string;
  address?: string | null;
  /** Branches. Each has its own address, coordinates, and hours. */
  locations?: PlaceLocation[];
  status?: PlaceStatus | string;
  verified_at?: string;
  hours_source?: string;
  coord_source?: string;
  review_decision?: string;
  verification_note?: string;
  review_flag?: string;
  hours_partially_verified?: boolean;
  /**
   * Sam kept some coffee shops as coverage until he has tried them.
   * The planner may schedule them, and prefers a real recommendation when it is just as close.
   */
  placeholder?: boolean;
};

const CLOSED = new Set(['closed', 'temporarily_closed']);

export function isClosedStatus(status?: string | null): boolean {
  return !!status && CLOSED.has(status);
}

export const FOOD_CATEGORIES = new Set([
  'breakfast',
  'brunch',
  'bakery',
  'lunch',
  'quick-bite',
  'dinner',
  'coffee',
  'sweets',
  'matcha',
  'drinks',
  'market',
]);

export const BREAKFAST_CATEGORIES = ['breakfast', 'brunch', 'bakery', 'coffee', 'matcha'];
export const LUNCH_CATEGORIES = ['lunch', 'quick-bite', 'brunch'];
export const DINNER_CATEGORIES = ['dinner'];
export const DRINKS_CATEGORIES = ['drinks'];
export const ACTIVITY_CATEGORIES = ['museum', 'landmark', 'park', 'activity', 'shopping', 'gallery', 'show'];

const places = rawPlaces as Place[];

export function getPlaces(): Place[] {
  return places;
}

/** Manhattan places the planner may schedule. Closed and paused spots stay in the file. */
export function getPlanningPlaces(): Place[] {
  return places.filter((place) => !isClosedStatus(place.status));
}

export function branchesOf(place: Place): PlaceLocation[] {
  const listed = (place.locations ?? []).filter(
    (branch) => Number.isFinite(branch.lat) && Number.isFinite(branch.lng)
  );
  if (listed.length) {
    return listed.map((branch) => ({
      ...branch,
      hours: branch.hours ?? null,
      neighborhood: branch.neighborhood || branch.label || place.neighborhood,
    }));
  }
  return [
    {
      id: place.id,
      label: place.neighborhood || place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      neighborhood: place.neighborhood,
      hours: place.hours ?? null,
      booking_url: place.booking_url,
    },
  ];
}

export function chooseNearestBranch(place: Place, anchor: { lat: number; lng: number }): PlaceLocation {
  const branches = branchesOf(place);
  let best = branches[0];
  let bestKm = Number.POSITIVE_INFINITY;
  for (const branch of branches) {
    const km = haversineKm(anchor, branch);
    if (km < bestKm) {
      best = branch;
      bestKm = km;
    }
  }
  return best;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isFoodPlace(place: Place): boolean {
  return place.categories.some((category) => FOOD_CATEGORIES.has(category));
}

export function hasCategory(place: Place, categories: string[]): boolean {
  return place.categories.some((category) => categories.includes(category));
}

/** The whole visit must sit inside one open window. Unknown hours are allowed. */
export function visitFitsHours(
  place: { hours?: number[][][] | null },
  weekday: number,
  startMin: number,
  durationMin: number
): boolean {
  if (!place.hours) return true;
  const windows = place.hours[weekday] ?? [];
  if (windows.length === 0) return false;
  const end = startMin + durationMin;
  return windows.some(([open, close]) => {
    if (typeof open !== 'number' || typeof close !== 'number') return false;
    if (close >= open) return startMin >= open && end <= close;
    const overnightClose = close + 1440;
    return (startMin >= open && end <= overnightClose) || (startMin + 1440 >= open && end + 1440 <= overnightClose);
  });
}

export function peopleForPlace(place: Place): RecommendedByPerson[] {
  return resolveRecommendations(place.recommended_by);
}
