import { HOODS, haversineKm } from './neighborhoods';

/** A place Google Places actually returned. Nothing here is guessed by a model. */
export type LookedUpPlace = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  neighborhood: string;
  mapsUrl: string;
  placeId: string;
  /** Sunday-first [openMinute, closeMinute] windows. Null when Google had no hours. */
  hours: number[][][] | null;
};

type SearchHit = {
  name?: string;
  formatted_address?: string;
  place_id?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
};

type DetailsResult = {
  name?: string;
  formatted_address?: string;
  url?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  opening_hours?: {
    periods?: Array<{
      open?: { day?: number; time?: string };
      close?: { day?: number; time?: string };
    }>;
  };
};

export type PlacesClient = {
  search: (query: string) => Promise<SearchHit[]>;
  details: (placeId: string) => Promise<DetailsResult | null>;
};

const MANHATTAN = { lat: 40.758, lng: -73.9855 };
const cache = new Map<string, LookedUpPlace[]>();

export function googlePlacesEnabled(apiKey = process.env.GOOGLE_MAPS_API_KEY): boolean {
  return Boolean(apiKey?.trim());
}

export function googleTimeToMinutes(value?: string): number | null {
  if (!value || !/^\d{3,4}$/.test(value)) return null;
  const padded = value.padStart(4, '0');
  const hour = Number(padded.slice(0, 2));
  const minute = Number(padded.slice(2));
  if (hour > 24 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Google periods use Sunday = 0, same as the planner. */
export function periodsToHours(
  periods?: DetailsResult['opening_hours']
): number[][][] | null {
  const list = periods?.periods;
  if (!list?.length) return null;
  const days: number[][][] = [[], [], [], [], [], [], []];
  for (const period of list) {
    const openDay = period.open?.day;
    const openMin = googleTimeToMinutes(period.open?.time);
    if (openDay == null || openDay < 0 || openDay > 6 || openMin == null) continue;
    const closeDay = period.close?.day;
    const closeMin = googleTimeToMinutes(period.close?.time);
    if (closeDay == null || closeMin == null) {
      days[openDay].push([openMin, 24 * 60]);
      continue;
    }
    if (closeDay === openDay && closeMin > openMin) {
      days[openDay].push([openMin, closeMin]);
      continue;
    }
    days[openDay].push([openMin, 24 * 60]);
    const next = (openDay + 1) % 7;
    if (closeDay === next && closeMin > 0) days[next].push([0, closeMin]);
  }
  if (days.every((day) => day.length === 0)) return null;
  return days;
}

export function neighborhoodFromPin(lat: number, lng: number): string {
  let best: { label: string; km: number } | null = null;
  for (const hood of HOODS) {
    const km = haversineKm({ lat, lng }, hood);
    if (!best || km < best.km) best = { label: hood.label, km };
  }
  return best?.label ?? 'New York';
}

function inNewYorkArea(address: string, lat: number, lng: number): boolean {
  const km = haversineKm({ lat, lng }, MANHATTAN);
  const local = /new york|manhattan|brooklyn|queens|bronx|staten island|\bny\b/i.test(address);
  if (local && km < 50) return true;
  return km < 20;
}

export function mapsSearchUrl(name: string, address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}`)}`;
}

function cacheKey(query: string): string {
  return query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function googlePlacesClient(apiKey: string, timeoutMs = 6000): PlacesClient {
  return {
    async search(query: string) {
      const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
      url.searchParams.set('query', query);
      url.searchParams.set('location', `${MANHATTAN.lat},${MANHATTAN.lng}`);
      url.searchParams.set('radius', '12000');
      url.searchParams.set('region', 'us');
      url.searchParams.set('key', apiKey);
      const data = (await fetchJson(url.toString(), timeoutMs)) as { results?: SearchHit[] } | null;
      return data?.results ?? [];
    },
    async details(placeId: string) {
      const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      url.searchParams.set('place_id', placeId);
      url.searchParams.set('fields', 'name,formatted_address,geometry,opening_hours,url');
      url.searchParams.set('key', apiKey);
      const data = (await fetchJson(url.toString(), timeoutMs)) as { result?: DetailsResult } | null;
      return data?.result ?? null;
    },
  };
}

export async function lookupPlaces(
  query: string,
  options?: { client?: PlacesClient; apiKey?: string; limit?: number }
): Promise<LookedUpPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const key = cacheKey(trimmed);
  const cached = cache.get(key);
  if (cached) return cached;

  const apiKey = options?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY?.trim();
  const client = options?.client ?? (apiKey ? googlePlacesClient(apiKey) : null);
  if (!client) {
    cache.set(key, []);
    return [];
  }

  let hits: SearchHit[] = [];
  try {
    hits = await client.search(trimmed);
  } catch {
    hits = [];
  }
  const found: LookedUpPlace[] = [];
  for (const hit of hits) {
    if (found.length >= (options?.limit ?? 3)) break;
    if (!hit.place_id) continue;
    let details: DetailsResult | null = null;
    try {
      details = await client.details(hit.place_id);
    } catch {
      details = null;
    }
    const name = details?.name || hit.name;
    const address = details?.formatted_address || hit.formatted_address;
    const lat = details?.geometry?.location?.lat ?? hit.geometry?.location?.lat;
    const lng = details?.geometry?.location?.lng ?? hit.geometry?.location?.lng;
    if (!name || !address || typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!inNewYorkArea(address, lat, lng)) continue;
    found.push({
      name,
      address,
      lat,
      lng,
      neighborhood: neighborhoodFromPin(lat, lng),
      mapsUrl: details?.url || mapsSearchUrl(name, address),
      placeId: hit.place_id,
      hours: periodsToHours(details?.opening_hours),
    });
  }
  cache.set(key, found);
  return found;
}

export function clearLookupCache(): void {
  cache.clear();
}
