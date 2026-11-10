const KEY = 'tb-last-itinerary';

export type CachedItinerary = {
  savedAt: string;
  date: string;
  city: string;
  stops: unknown[];
  warnings: string[];
  mapsUrl: string | null;
  bookAhead: unknown[];
};

export function saveLastItinerary(entry: CachedItinerary) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // Private mode or a full disk. The day still shows for this session.
  }
}

export function loadLastItinerary(): CachedItinerary | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedItinerary;
    if (!parsed || !Array.isArray(parsed.stops) || parsed.stops.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}
