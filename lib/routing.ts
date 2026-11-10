import { haversineKm } from './neighborhoods';

export type LatLng = { lat: number; lng: number };

export type Leg = {
  mode: 'walk' | 'transit';
  minutes: number;
  summary: string;
  lines: string[];
  scenic?: string;
  mapsUrl: string;
  source: 'google' | 'estimate';
};

type Station = { name: string; lat: number; lng: number; lines: string[] };

const STATIONS: Station[] = [
  { name: '125th St (A)', lat: 40.811, lng: -73.952, lines: ['A', 'B', 'C', 'D'] },
  { name: '125th St (Lex)', lat: 40.804, lng: -73.937, lines: ['4', '5', '6'] },
  { name: '116th St (Columbia)', lat: 40.808, lng: -73.964, lines: ['1'] },
  { name: '96th St (Broadway)', lat: 40.794, lng: -73.972, lines: ['1', '2', '3'] },
  { name: '96th St (Lex)', lat: 40.785, lng: -73.951, lines: ['6'] },
  { name: '86th St (Lex)', lat: 40.779, lng: -73.955, lines: ['4', '5', '6'] },
  { name: '72nd St (Broadway)', lat: 40.778, lng: -73.982, lines: ['1', '2', '3'] },
  { name: '72nd St (CPW)', lat: 40.776, lng: -73.976, lines: ['B', 'C'] },
  { name: '81st St-Museum', lat: 40.781, lng: -73.972, lines: ['B', 'C'] },
  { name: '86th St (CPW)', lat: 40.786, lng: -73.969, lines: ['B', 'C'] },
  { name: '103rd St (CPW)', lat: 40.796, lng: -73.961, lines: ['B', 'C'] },
  { name: 'Cathedral Pkwy', lat: 40.801, lng: -73.958, lines: ['B', 'C'] },
  { name: '116th St (2/3)', lat: 40.802, lng: -73.95, lines: ['2', '3'] },
  { name: '125th St (2/3)', lat: 40.807, lng: -73.945, lines: ['2', '3'] },
  { name: '59th St-Columbus Circle', lat: 40.768, lng: -73.982, lines: ['1', 'A', 'B', 'C', 'D'] },
  { name: 'Lexington Av-59th', lat: 40.763, lng: -73.967, lines: ['4', '5', '6', 'N', 'R', 'W'] },
  { name: '5th Av-59th', lat: 40.764, lng: -73.973, lines: ['N', 'R', 'W'] },
  { name: 'Times Sq-42nd', lat: 40.755, lng: -73.987, lines: ['1', '2', '3', '7', 'N', 'Q', 'R', 'W', 'A', 'C', 'E', 'S'] },
  { name: 'Grand Central', lat: 40.7527, lng: -73.9772, lines: ['4', '5', '6', '7', 'S'] },
  { name: '42nd St-Bryant Park', lat: 40.754, lng: -73.984, lines: ['B', 'D', 'F', 'M', '7'] },
  { name: '34th St-Herald Sq', lat: 40.75, lng: -73.988, lines: ['B', 'D', 'F', 'M', 'N', 'Q', 'R', 'W'] },
  { name: '34th St-Penn', lat: 40.751, lng: -73.991, lines: ['1', '2', '3', 'A', 'C', 'E'] },
  { name: '34th St-Hudson Yards', lat: 40.755, lng: -74.001, lines: ['7'] },
  { name: '14th St (8th Ave)', lat: 40.74, lng: -74.002, lines: ['A', 'C', 'E', 'L'] },
  { name: '14th St (6th Ave)', lat: 40.737, lng: -73.997, lines: ['F', 'M', 'L', '1', '2', '3'] },
  { name: '14th St-Union Sq', lat: 40.735, lng: -73.991, lines: ['4', '5', '6', 'L', 'N', 'Q', 'R', 'W'] },
  { name: 'West 4th', lat: 40.732, lng: -74.001, lines: ['A', 'B', 'C', 'D', 'E', 'F', 'M'] },
  { name: 'Christopher St', lat: 40.734, lng: -74.007, lines: ['1'] },
  { name: 'Astor Pl', lat: 40.73, lng: -73.991, lines: ['6'] },
  { name: 'Broadway-Lafayette', lat: 40.725, lng: -73.996, lines: ['B', 'D', 'F', 'M', '6'] },
  { name: 'Houston St', lat: 40.728, lng: -74.005, lines: ['1'] },
  { name: '2nd Av', lat: 40.723, lng: -73.989, lines: ['F'] },
  { name: 'Delancey-Essex', lat: 40.719, lng: -73.988, lines: ['F', 'J', 'M', 'Z'] },
  { name: 'Canal St', lat: 40.718, lng: -74.001, lines: ['A', 'C', 'E', 'N', 'Q', 'R', 'W', 'J', 'Z', '6'] },
  { name: 'Chambers St', lat: 40.715, lng: -74.009, lines: ['1', '2', '3', 'A', 'C'] },
  { name: 'Brooklyn Bridge-City Hall', lat: 40.713, lng: -74.004, lines: ['4', '5', '6', 'J', 'Z'] },
  { name: 'Fulton St', lat: 40.71, lng: -74.008, lines: ['2', '3', '4', '5', 'A', 'C', 'J', 'Z'] },
  { name: 'Wall St', lat: 40.707, lng: -74.011, lines: ['2', '3', '4', '5'] },
  { name: 'High St', lat: 40.699, lng: -73.991, lines: ['A', 'C'] },
  { name: 'York St', lat: 40.701, lng: -73.987, lines: ['F'] },
  { name: 'Clark St', lat: 40.697, lng: -73.993, lines: ['2', '3'] },
  { name: 'Court St', lat: 40.694, lng: -73.991, lines: ['R'] },
  { name: 'Jay St-MetroTech', lat: 40.692, lng: -73.987, lines: ['A', 'C', 'F', 'R'] },
  { name: 'Bergen St', lat: 40.686, lng: -73.975, lines: ['2', '3', 'F', 'G'] },
  { name: 'Carroll St', lat: 40.68, lng: -73.995, lines: ['F', 'G'] },
  { name: 'Atlantic Av', lat: 40.684, lng: -73.979, lines: ['2', '3', '4', '5', 'B', 'D', 'N', 'Q', 'R'] },
  { name: 'Bedford Av', lat: 40.717, lng: -73.957, lines: ['L'] },
  { name: 'Lorimer St', lat: 40.714, lng: -73.95, lines: ['L', 'G'] },
  { name: 'Metropolitan Av', lat: 40.712, lng: -73.951, lines: ['G'] },
  { name: 'Nassau Av', lat: 40.724, lng: -73.951, lines: ['G'] },
  { name: 'Greenpoint Av', lat: 40.731, lng: -73.954, lines: ['G'] },
  { name: 'Court Sq', lat: 40.747, lng: -73.946, lines: ['G', 'E', 'M', '7'] },
];

export function streetKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1.25;
}

export function walkMinutesBetween(a: LatLng, b: LatLng): number {
  return Math.max(1, Math.round(streetKm(a, b) * 12.5));
}

export function mapsDirUrl(origin: string, destination: string, travelmode: 'walking' | 'transit', waypoints?: string[]): string {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  url.searchParams.set('travelmode', travelmode);
  if (waypoints && waypoints.length) url.searchParams.set('waypoints', waypoints.join('|'));
  return url.toString();
}

export function pointToken(point: { lat?: number; lng?: number; label?: string }): string {
  if (typeof point.lat === 'number' && typeof point.lng === 'number') {
    return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
  }
  return point.label?.trim() || 'New York, NY';
}

export function dayMapsUrl(
  stops: { lat?: number; lng?: number; label?: string }[],
  travelmode: 'walking' | 'transit' = 'walking'
): string {
  const tokens = stops.map((stop) => pointToken(stop)).filter(Boolean);
  if (tokens.length === 0) return 'https://www.google.com/maps/dir/?api=1';
  if (tokens.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tokens[0])}`;
  }
  return mapsDirUrl(tokens[0], tokens[tokens.length - 1], travelmode, tokens.slice(1, -1));
}

function scenicWalk(a: LatLng, b: LatLng, walkMin: number): string | undefined {
  const onHighLine = (p: LatLng) => p.lng <= -73.998 && p.lng >= -74.012 && p.lat >= 40.739 && p.lat <= 40.756;
  if (onHighLine(a) && onHighLine(b) && walkMin <= 45) return 'the High Line';

  const inPark = (p: LatLng) => p.lat >= 40.764 && p.lat <= 40.8 && p.lng >= -73.982 && p.lng <= -73.949;
  if (inPark(a) && inPark(b) && walkMin <= 50) return 'Central Park';

  const manhattanBridgeSide = (p: LatLng) => p.lat >= 40.704 && p.lat <= 40.714 && p.lng <= -74.002 && p.lng >= -74.014;
  const brooklynBridgeSide = (p: LatLng) => p.lat >= 40.695 && p.lat <= 40.706 && p.lng >= -74.0 && p.lng <= -73.989;
  if (
    walkMin <= 45 &&
    ((manhattanBridgeSide(a) && brooklynBridgeSide(b)) || (manhattanBridgeSide(b) && brooklynBridgeSide(a)))
  ) {
    return 'the Brooklyn Bridge';
  }

  const westVillage = (p: LatLng) => p.lat >= 40.728 && p.lat <= 40.74 && p.lng <= -73.998 && p.lng >= -74.012;
  if (westVillage(a) && westVillage(b) && walkMin <= 35) return 'West Village streets';
  return undefined;
}

function busFallback(a: LatLng, b: LatLng): string[] {
  const bothManhattan = a.lat > 40.7 && b.lat > 40.7 && a.lng < -73.93 && b.lng < -73.93 && a.lat < 40.88 && b.lat < 40.88;
  if (!bothManhattan) return [];
  if (a.lng > -73.97 && b.lng > -73.97) return ['M15'];
  if (a.lng < -73.985 && b.lng < -73.985) return ['M5'];
  return ['M1'];
}

function transitEstimate(a: LatLng, b: LatLng): { minutes: number; lines: string[] } {
  const near = (point: LatLng) =>
    STATIONS.filter((station) => haversineKm(point, station) <= 0.8)
      .sort((left, right) => haversineKm(point, left) - haversineKm(point, right))
      .slice(0, 4);

  const origins = near(a);
  const destinations = near(b);
  let best: { minutes: number; lines: string[] } | null = null;

  const consider = (minutes: number, lines: string[]) => {
    if (!lines.length || minutes <= 0) return;
    if (!best || minutes < best.minutes) best = { minutes: Math.max(8, Math.round(minutes)), lines };
  };

  for (const origin of origins) {
    for (const destination of destinations) {
      const shared = origin.lines.filter((line) => destination.lines.includes(line));
      if (!shared.length) continue;
      const minutes =
        walkMinutesBetween(a, origin) + 4 + haversineKm(origin, destination) * 2.6 + walkMinutesBetween(destination, b);
      consider(minutes, shared.slice(0, 3));
    }
  }

  if (!best) {
    for (const origin of origins) {
      for (const destination of destinations) {
        for (const hub of STATIONS) {
          const first = origin.lines.find((line) => hub.lines.includes(line));
          if (!first) continue;
          const hubKm = haversineKm(origin, hub);
          if (hubKm < 0.4) continue;
          for (const secondHub of STATIONS) {
            if (haversineKm(hub, secondHub) > 0.4) continue;
            const second = destination.lines.find((line) => secondHub.lines.includes(line) && line !== first);
            if (!second) continue;
            const ride = haversineKm(origin, hub) + haversineKm(secondHub, destination);
            const direct = haversineKm(a, b);
            if (ride > direct * 1.8 + 3) continue;
            const minutes =
              walkMinutesBetween(a, origin) +
              5 +
              haversineKm(origin, hub) * 2.6 +
              4 +
              haversineKm(secondHub, destination) * 2.6 +
              walkMinutesBetween(destination, b);
            consider(minutes, [first, second]);
          }
        }
      }
    }
  }

  if (best) return best;
  const km = haversineKm(a, b);
  return { minutes: Math.max(12, Math.round(8 + km * 4.2)), lines: busFallback(a, b) };
}

export function estimateLeg(
  origin: LatLng & { label?: string },
  destination: LatLng & { label?: string }
): Leg {
  const walkMin = walkMinutesBetween(origin, destination);
  const scenic = scenicWalk(origin, destination, walkMin);
  const originToken = pointToken(origin);
  const destinationToken = pointToken(destination);
  if (walkMin <= 20 || scenic) {
    const via = scenic ? ` along ${scenic}` : '';
    return {
      mode: 'walk',
      minutes: walkMin,
      summary: `${walkMin} min walk${via}`,
      lines: [],
      scenic,
      mapsUrl: mapsDirUrl(originToken, destinationToken, 'walking'),
      source: 'estimate',
    };
  }
  const transit = transitEstimate(origin, destination);
  const lineText = transit.lines.length ? ` (${transit.lines.join(', ')})` : '';
  return {
    mode: 'transit',
    minutes: transit.minutes,
    summary: `${transit.minutes} min by subway/bus${lineText}`,
    lines: transit.lines,
    mapsUrl: mapsDirUrl(originToken, destinationToken, 'transit'),
    source: 'estimate',
  };
}

type GoogleLeg = { minutes: number; lines: string[] };

async function googleDirections(
  origin: string,
  destination: string,
  mode: 'walking' | 'transit'
): Promise<GoogleLeg | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  url.searchParams.set('mode', mode);
  url.searchParams.set('region', 'us');
  url.searchParams.set('key', key);
  try {
    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      routes?: { legs?: { duration?: { value?: number }; steps?: { transit_details?: { line?: { short_name?: string } } }[] }[] }[];
    };
    const leg = data.routes?.[0]?.legs?.[0];
    if (!leg?.duration?.value) return null;
    const lines: string[] = [];
    for (const step of leg.steps ?? []) {
      const name = step.transit_details?.line?.short_name;
      if (name && !lines.includes(name)) lines.push(name);
    }
    return { minutes: Math.max(1, Math.round(leg.duration.value / 60)), lines };
  } catch {
    return null;
  }
}

/** Real walking/transit times when GOOGLE_MAPS_API_KEY is set. Otherwise the coordinate estimate. */
export async function routeLeg(
  origin: LatLng & { label?: string },
  destination: LatLng & { label?: string }
): Promise<Leg> {
  const estimate = estimateLeg(origin, destination);
  if (!process.env.GOOGLE_MAPS_API_KEY) return estimate;
  const originToken = pointToken(origin);
  const destinationToken = pointToken(destination);
  const [walking, transit] = await Promise.all([
    googleDirections(originToken, destinationToken, 'walking'),
    googleDirections(originToken, destinationToken, 'transit'),
  ]);
  const walkMin = walking?.minutes ?? walkMinutesBetween(origin, destination);
  const scenic = scenicWalk(origin, destination, walkMin);
  if (walkMin <= 20 || scenic) {
    const via = scenic ? ` along ${scenic}` : '';
    return {
      mode: 'walk',
      minutes: walkMin,
      summary: `${walkMin} min walk${via}`,
      lines: [],
      scenic,
      mapsUrl: mapsDirUrl(originToken, destinationToken, 'walking'),
      source: walking ? 'google' : 'estimate',
    };
  }
  const transitMin = transit?.minutes ?? (estimate.mode === 'transit' ? estimate.minutes : transitEstimate(origin, destination).minutes);
  const lines = transit?.lines?.length ? transit.lines : estimate.lines;
  const lineText = lines.length ? ` (${lines.join(', ')})` : '';
  return {
    mode: 'transit',
    minutes: transitMin,
    summary: `${transitMin} min by subway/bus${lineText}`,
    lines,
    mapsUrl: mapsDirUrl(originToken, destinationToken, 'transit'),
    source: transit ? 'google' : 'estimate',
  };
}
