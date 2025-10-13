// lib/providers/hours.ts
// Hours verification + branch resolution using Google Places API (optional),
// with a minimal HTML fallback if no API key is present.
// Put GOOGLE_MAPS_API_KEY=... in .env.local for best results.

type Maybe<T> = T | undefined;

export type PlaceHours = {
  openNow?: boolean;
  weekdayText?: string[]; // e.g., ["Monday: 10 AM–6 PM", ...]
  periods?: Array<{
    open: { day: number; time: string };   // time like "0900"
    close?: { day: number; time: string }; // optional
  }>;
};

export type BranchCandidate = {
  name: string;
  address?: string;
  neighborhood?: string;
  lat?: number;
  lng?: number;
  place_id?: string;
};

const PLACES_KEY = process.env.GOOGLE_MAPS_API_KEY;

// --- Helpers ---
function norm(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function neighborhoodFromAddress(addr?: string): string | undefined {
  if (!addr) return;
  // crude extraction: take everything before "New York" and keep a short area-ish token
  const idx = addr.toLowerCase().indexOf("new york");
  const head = idx > 0 ? addr.slice(0, idx) : addr;
  const parts = head.split(",").map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : undefined;
}

async function httpJSON<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

// --- Google Places Search + Details ---
async function searchPlacesByText(query: string, city: string): Promise<BranchCandidate[]> {
  if (!PLACES_KEY) return [];
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", `${query} ${city}`);
  url.searchParams.set("key", PLACES_KEY!);
  // optional: bias to NYC
  url.searchParams.set("location", "40.7128,-74.0060");
  url.searchParams.set("radius", "15000");

  const data = await httpJSON<any>(url.toString());
  const out: BranchCandidate[] = (data.results || []).map((r: any) => ({
    name: r.name,
    address: r.formatted_address,
    neighborhood: neighborhoodFromAddress(r.formatted_address),
    lat: r.geometry?.location?.lat,
    lng: r.geometry?.location?.lng,
    place_id: r.place_id,
  }));
  return out;
}

async function getPlaceDetails(place_id: string): Promise<{ hours?: PlaceHours; url?: string }> {
  if (!PLACES_KEY) return {};
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", place_id);
  url.searchParams.set("fields", "opening_hours,website,url");
  url.searchParams.set("key", PLACES_KEY!);

  const data = await httpJSON<any>(url.toString());
  const d = data?.result;
  if (!d) return {};
  const hours: PlaceHours | undefined = d.opening_hours
    ? {
        openNow: d.opening_hours.open_now,
        weekdayText: d.opening_hours.weekday_text,
        periods: d.opening_hours.periods,
      }
    : undefined;
  const urlOut = d.website || d.url;
  return { hours, url: urlOut };
}

// --- Minimal HTML fallback (very naive) ---
async function tryFetchHoursFromWebsite(url: string): Promise<Maybe<PlaceHours>> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "TravelBuddyBot/1.0" } });
    const text = await res.text();
    // naive regex for "Mon".."Sun" lines
    const lines = Array.from(text.matchAll(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^<\n\r]{0,80}(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?[^<\n\r]{0,20}(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/gi)).slice(0,7);
    if (!lines.length) return undefined;
    const weekdayText = lines.map(m => m[0]);
    return { weekdayText };
  } catch {
    return undefined;
  }
}

// --- Public: hours + branch selection ---
export async function verifyPlaceHoursByName(name: string, city: string): Promise<{ hours?: PlaceHours; bestBranch?: BranchCandidate; website?: string }> {
  // 1) Search candidates
  const results = await searchPlacesByText(name, city);
  if (!results.length) return {};

  // 2) Pick the first as "best" by default; caller can re-rank by distance later
  let best = results[0];

  // 3) Get details for hours
  let hours: PlaceHours | undefined;
  let website: string | undefined;

  if (best.place_id) {
    const d = await getPlaceDetails(best.place_id);
    hours = d.hours;
    website = d.url;
  }

  // 4) Fallback: try scraping the website for hours
  if (!hours && website) {
    const scraped = await tryFetchHoursFromWebsite(website);
    if (scraped) hours = scraped;
  }
  return { hours, bestBranch: best, website };
}

// Choose the best branch near an area hint (string match on neighborhood)
export async function resolveBestBranchForChain(chainName: string, city: string, areaHint?: string): Promise<BranchCandidate | undefined> {
  const results = await searchPlacesByText(chainName, city);
  if (!results.length) return undefined;
  if (!areaHint) return results[0];
  const hint = norm(areaHint);
  const scored = results.map(r => {
    const n = norm(r.neighborhood || r.address || "");
    const score = n.includes(hint) ? 0 : (n.split(" ").some(w => hint.includes(w)) ? 1 : 2);
    return { r, score };
  }).sort((a, b) => a.score - b.score);
  return scored[0]?.r;
}
