import { getTravelDurationsFromMaps } from './providers/distance';

const CENTROIDS: Record<string, { lat: number; lon: number }> = {
  "Lower East Side": { lat: 40.7179, lon: -73.9893 },
  "Upper West Side": { lat: 40.7870, lon: -73.9754 },
  "Upper East Side": { lat: 40.7736, lon: -73.9566 },
  "Midtown": { lat: 40.7549, lon: -73.9840 },
  "Midtown South": { lat: 40.7489, lon: -73.9867 },
  "Times Square": { lat: 40.7580, lon: -73.9855 },
  "Greenwich Village": { lat: 40.7336, lon: -74.0027 },
  "West Village": { lat: 40.7358, lon: -74.0036 },
  "East Village": { lat: 40.7265, lon: -73.9815 },
  "SoHo": { lat: 40.7233, lon: -74.0030 },
  "NoHo": { lat: 40.7272, lon: -73.9922 },
  "Nolita": { lat: 40.7236, lon: -73.9950 },
  "Tribeca": { lat: 40.7163, lon: -74.0086 },
  "Chinatown": { lat: 40.7158, lon: -73.9970 },
  "Flatiron": { lat: 40.7411, lon: -73.9897 },
  "Union Square": { lat: 40.7359, lon: -73.9911 },
  "Chelsea": { lat: 40.7465, lon: -74.0014 },
  "Chelsea Market": { lat: 40.7423, lon: -74.0060 },
  "Chelsea / Hudson Yards": { lat: 40.7532, lon: -74.0010 },
  "Hudson Yards": { lat: 40.7540, lon: -74.0027 },
  "Meatpacking": { lat: 40.7409, lon: -74.0086 },
  "Rockefeller Center": { lat: 40.7587, lon: -73.9787 },
  "Central Park": { lat: 40.7829, lon: -73.9654 },
  "Harlem": { lat: 40.8116, lon: -73.9465 },
  "Washington Heights": { lat: 40.8517, lon: -73.9361 },
  "Financial District": { lat: 40.7075, lon: -74.0113 },
  "Battery Park City": { lat: 40.7115, lon: -74.0153 },
  "Lower Manhattan": { lat: 40.7073, lon: -74.0113 },
  "DUMBO": { lat: 40.7033, lon: -73.9881 },
  "Brooklyn Heights": { lat: 40.6960, lon: -73.9967 },
  "Downtown Brooklyn": { lat: 40.6943, lon: -73.9850 },
  "Williamsburg": { lat: 40.7081, lon: -73.9571 },
  "Greenpoint": { lat: 40.7293, lon: -73.9547 },
  "Bushwick": { lat: 40.6958, lon: -73.9171 },
  "Bed-Stuy": { lat: 40.6872, lon: -73.9418 },
  "Park Slope": { lat: 40.6720, lon: -73.9816 },
  "Prospect Heights": { lat: 40.6796, lon: -73.9663 },
  "Prospect Park": { lat: 40.6602, lon: -73.9690 },
  "Long Island City": { lat: 40.7440, lon: -73.9488 },
  "Astoria": { lat: 40.7644, lon: -73.9235 },
  "Jackson Heights": { lat: 40.7557, lon: -73.8831 },
  "Flushing": { lat: 40.7675, lon: -73.8331 },
  "Queensboro Plaza": { lat: 40.7506, lon: -73.9407 },
  "Bronx": { lat: 40.8448, lon: -73.8648 },
  "Staten Island": { lat: 40.5795, lon: -74.1502 }
};

export function centroidFor(loc?: string) {
  if (!loc) return null;
  if (CENTROIDS[loc]) return CENTROIDS[loc];
  const lower = loc.toLowerCase();
  for (const [key, value] of Object.entries(CENTROIDS)) {
    const keyLower = key.toLowerCase();
    if (lower.includes(keyLower) || keyLower.includes(lower)) {
      return value;
    }
  }
  return null;
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const component = sinHalfLat * sinHalfLat + sinHalfLon * sinHalfLon * Math.cos(lat1) * Math.cos(lat2);
  const clamped = Math.min(1, Math.max(0, component));
  const c = 2 * Math.asin(Math.sqrt(clamped));
  return R * c;
}

// Approximate walking minutes: ~4.8 km/h (12.5 min/km), cap short hops and long hauls
export function walkingMinutesKm(km: number) {
  const mins = km * 12.5;
  return Math.max(8, Math.min(50, Math.round(mins)));
}

export function travelMinutesBetween(aLoc?: string, bLoc?: string) {
  if (!aLoc || !bLoc) return fallbackTravelEstimate(aLoc, bLoc);
  const a = centroidFor(aLoc);
  const b = centroidFor(bLoc);
  if (!a || !b) return fallbackTravelEstimate(aLoc, bLoc);

  const km = haversineKm(a, b);
  if (!isFinite(km) || km < 0) return fallbackTravelEstimate(aLoc, bLoc);

  const boroughA = inferBorough(aLoc);
  const boroughB = inferBorough(bLoc);
  const crossBorough = boroughA && boroughB && boroughA !== boroughB;

  if (km <= 2.4 && !crossBorough) {
    return walkingMinutesKm(km);
  }

  if (crossBorough) {
    const base = Math.round(14 + km * 4.8);
    return Math.min(Math.max(base, 24), 55);
  }

  const walking = walkingMinutesKm(km);
  const transit = Math.round(8 + km * 5.5);
  return Math.min(Math.max(transit, Math.max(12, walking)), 70);
}

function inferBorough(loc?: string): 'manhattan' | 'brooklyn' | 'queens' | 'bronx' | 'staten' | null {
  if (!loc) return null;
  const lower = loc.toLowerCase();
  if (/\b(bronx)\b/.test(lower)) return 'bronx';
  if (/\bstaten island\b/.test(lower)) return 'staten';
  if (/\b(queens|astoria|long island city|lic|jackson heights|flushing)\b/.test(lower)) return 'queens';
  if (/\b(brooklyn|williamsburg|greenpoint|bushwick|bed-stuy|bedford stuyvesant|park slope|prospect heights|red hook|dumbo|downtown brooklyn)\b/.test(lower)) return 'brooklyn';
  if (/\b(manhattan|midtown|upper east side|upper west side|harlem|washington heights|inwood|village|soho|tribeca|financial district|battery park|lincoln square|hell['’]s kitchen|chelsea|flatiron|times square|gramercy|east village|west village)\b/.test(lower)) return 'manhattan';
  return null;
}

function fallbackTravelEstimate(aLoc?: string, bLoc?: string): number {
  if (!aLoc || !bLoc) return 22;
  const a = aLoc.toLowerCase();
  const b = bLoc.toLowerCase();
  const boroughA = inferBorough(aLoc);
  const boroughB = inferBorough(bLoc);
  if (boroughA && boroughB && boroughA !== boroughB) {
    return 28;
  }
  if (a.includes('village') && b.includes('village')) return 14;
  if (a.includes('midtown') && b.includes('midtown')) return 14;
  if (a.includes('harlem') || b.includes('harlem')) return 26;
  if (a.includes('queens') || b.includes('queens')) return 32;
  if (a.includes('brooklyn') || b.includes('brooklyn')) return 28;
  return 20;
}

const accurateCache = new Map<string, { minutes: number; mode: 'walk' | 'transit' } | null>();

function canonicalLocationText(loc: string): string {
  const trimmed = loc.trim();
  if (!trimmed) return 'New York, NY';
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed.replace(/\s+/g, '');
  }
  if (/new york/i.test(trimmed)) return trimmed;
  return `${trimmed}, New York, NY`;
}

function accurateCacheKey(origin: string, destination: string, date?: string) {
  return `${origin.toLowerCase()}→${destination.toLowerCase()}@${date || 'any'}`;
}

function departureEpoch(dateISO?: string): number | undefined {
  if (!dateISO) return undefined;
  const dt = new Date(`${dateISO}T13:00:00`);
  const epochMs = dt.getTime();
  if (!Number.isFinite(epochMs)) return undefined;
  return Math.max(0, Math.floor(epochMs / 1000));
}

export async function accurateTravelMinutesBetween(
  origin?: string,
  destination?: string,
  opts?: { date?: string }
): Promise<{ minutes: number; mode: 'walk' | 'transit' } | null> {
  if (!origin || !destination) return null;
  const originKey = canonicalLocationText(origin);
  const destinationKey = canonicalLocationText(destination);
  const cacheKey = accurateCacheKey(originKey, destinationKey, opts?.date);
  if (accurateCache.has(cacheKey)) return accurateCache.get(cacheKey) ?? null;

  try {
    const durations = await getTravelDurationsFromMaps(originKey, destinationKey, {
      departureTime: departureEpoch(opts?.date),
    });
    if (!durations) {
      accurateCache.set(cacheKey, null);
      return null;
    }

    const walking = durations.walking ?? null;
    const transit = durations.transit ?? null;

    let mode: 'walk' | 'transit';
    let minutes: number;

    if (walking != null && transit != null) {
      if (walking <= 20 || walking <= transit + 4) {
        mode = 'walk';
        minutes = walking;
      } else {
        mode = 'transit';
        minutes = transit;
      }
    } else if (walking != null) {
      mode = 'walk';
      minutes = walking;
    } else if (transit != null) {
      mode = 'transit';
      minutes = transit;
    } else {
      accurateCache.set(cacheKey, null);
      return null;
    }

    if (!Number.isFinite(minutes) || minutes <= 0) {
      accurateCache.set(cacheKey, null);
      return null;
    }

    const result = { minutes, mode };
    accurateCache.set(cacheKey, result);
    return result;
  } catch {
    accurateCache.set(cacheKey, null);
    return null;
  }
}
