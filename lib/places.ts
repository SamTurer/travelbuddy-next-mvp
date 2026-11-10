import rawPlaces from '../data/nyc-places.json';
import type { BookingKind } from './booking';
import { resolveRecommendations, type RecommendationRef, type RecommendedByPerson } from './recommenders';

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
  /** Editor comment from Sam, Kailey, or a friend. Empty until they fill it in. */
  note: string;
  booking: BookingKind;
  booking_note?: string;
  booking_url?: string;
  url?: string;
};

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
export const ACTIVITY_CATEGORIES = ['museum', 'landmark', 'park', 'activity', 'shopping', 'gallery'];

const places = rawPlaces as Place[];

export function getPlaces(): Place[] {
  return places;
}

export function isFoodPlace(place: Place): boolean {
  return place.categories.some((category) => FOOD_CATEGORIES.has(category));
}

export function hasCategory(place: Place, categories: string[]): boolean {
  return place.categories.some((category) => categories.includes(category));
}

/** The whole visit must sit inside one open window. Unknown hours are allowed. */
export function visitFitsHours(place: Place, weekday: number, startMin: number, durationMin: number): boolean {
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
