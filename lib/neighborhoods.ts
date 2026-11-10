import type { Place } from './places';

export type Hood = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  aliases: string[];
  adjacent: string[];
};

export const HOODS: Hood[] = [
  { id: 'harlem', label: 'Harlem', lat: 40.8116, lng: -73.9465, aliases: ['harlem'], adjacent: ['uws', 'central-park'] },
  { id: 'uws', label: 'Upper West Side', lat: 40.787, lng: -73.9754, aliases: ['upper west side', 'morningside'], adjacent: ['harlem', 'central-park', 'midtown'] },
  { id: 'ues', label: 'Upper East Side', lat: 40.7736, lng: -73.9566, aliases: ['upper east side'], adjacent: ['central-park', 'midtown'] },
  { id: 'central-park', label: 'Central Park', lat: 40.7829, lng: -73.9654, aliases: ['central park'], adjacent: ['uws', 'ues', 'midtown'] },
  { id: 'midtown', label: 'Midtown', lat: 40.758, lng: -73.9855, aliases: ['midtown', 'theater district', 'times square', 'rockefeller', 'columbus circle', 'grand central', 'herald square', 'penn station', "hell's kitchen", 'hudson yards'], adjacent: ['uws', 'ues', 'central-park', 'chelsea'] },
  { id: 'chelsea', label: 'Chelsea', lat: 40.7465, lng: -74.0014, aliases: ['chelsea', 'meatpacking', 'flatiron', 'nomad', 'union square', 'gramercy'], adjacent: ['midtown', 'west-village', 'soho'] },
  { id: 'west-village', label: 'West Village', lat: 40.735, lng: -74.003, aliases: ['west village', 'greenwich village'], adjacent: ['chelsea', 'soho', 'east-village', 'tribeca'] },
  { id: 'east-village', label: 'East Village', lat: 40.7265, lng: -73.984, aliases: ['east village', 'noho', 'bowery'], adjacent: ['west-village', 'les', 'soho'] },
  { id: 'les', label: 'Lower East Side', lat: 40.718, lng: -73.987, aliases: ['lower east side', 'dimes square', 'essex crossing'], adjacent: ['east-village', 'chinatown', 'soho'] },
  { id: 'soho', label: 'SoHo', lat: 40.7233, lng: -74.0, aliases: ['soho', 'nolita', 'hudson square'], adjacent: ['west-village', 'tribeca', 'les', 'chinatown', 'chelsea', 'east-village'] },
  { id: 'chinatown', label: 'Chinatown', lat: 40.7158, lng: -73.997, aliases: ['chinatown'], adjacent: ['les', 'soho', 'fidi', 'tribeca'] },
  { id: 'tribeca', label: 'Tribeca', lat: 40.7163, lng: -74.0086, aliases: ['tribeca', 'battery park city'], adjacent: ['soho', 'fidi', 'west-village', 'chinatown'] },
  { id: 'fidi', label: 'Financial District', lat: 40.7075, lng: -74.0113, aliases: ['financial district', 'fidi', 'wall street', 'battery park', 'lower manhattan'], adjacent: ['tribeca', 'chinatown', 'dumbo'] },
  { id: 'williamsburg', label: 'Williamsburg', lat: 40.714, lng: -73.961, aliases: ['williamsburg', 'greenpoint', 'east williamsburg'], adjacent: ['dumbo', 'bushwick'] },
  { id: 'dumbo', label: 'DUMBO', lat: 40.7033, lng: -73.989, aliases: ['dumbo', 'brooklyn heights', 'downtown brooklyn', 'brooklyn bridge'], adjacent: ['williamsburg', 'carroll', 'fidi'] },
  { id: 'carroll', label: 'Carroll Gardens', lat: 40.678, lng: -73.995, aliases: ['carroll gardens', 'cobble hill', 'boerum', 'gowanus', 'park slope', 'prospect'], adjacent: ['dumbo', 'bushwick'] },
  { id: 'bushwick', label: 'Bushwick', lat: 40.694, lng: -73.921, aliases: ['bushwick', 'bed-stuy', 'bedford', 'crown heights', 'ridgewood'], adjacent: ['williamsburg', 'carroll'] },
  { id: 'astoria', label: 'Astoria', lat: 40.764, lng: -73.923, aliases: ['astoria', 'jackson heights', 'elmhurst', 'queens'], adjacent: [] },
];

const HOOD_BY_ID = new Map(HOODS.map((hood) => [hood.id, hood]));

/** UI focus values from lib/areas.ts, mapped to one neighborhood. */
const FOCUS_TO_HOOD: Record<string, string> = {
  'upper west side': 'uws',
  'upper east side': 'ues',
  'central park': 'central-park',
  harlem: 'harlem',
  'midtown corridor': 'midtown',
  'flatiron chelsea': 'chelsea',
  'soho nolita': 'soho',
  'west village greenwich village': 'west-village',
  tribeca: 'tribeca',
  'lower east side': 'les',
  chinatown: 'chinatown',
  'fidi downtown': 'fidi',
  brooklyn: 'williamsburg',
};

export function hoodById(id: string): Hood | undefined {
  return HOOD_BY_ID.get(id);
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const ALIASES = HOODS.flatMap((hood) => hood.aliases.map((alias) => ({ alias, hood }))).sort(
  (a, b) => b.alias.length - a.alias.length
);

/**
 * Neighborhood for planning. Places whose pin sits far from the neighborhood
 * named in the data are skipped for automatic fills (the pin is probably wrong).
 */
export function hoodForPlace(place: Place): string | null {
  const text = (place.neighborhood || '').toLowerCase();
  let textMatch: { id: string; km: number } | null = null;
  const seen = new Set<string>();
  for (const { alias, hood } of ALIASES) {
    if (seen.has(hood.id)) continue;
    if (!text.includes(alias)) continue;
    seen.add(hood.id);
    const km = haversineKm(place, hood);
    if (!textMatch || km < textMatch.km) textMatch = { id: hood.id, km };
  }
  // A named neighborhood whose pin is miles away is bad data. Don't
  // pretend the pin's nearest hood is where the place actually is.
  if (textMatch) return textMatch.km <= 4 ? textMatch.id : null;

  let nearest: { id: string; km: number } | null = null;
  for (const hood of HOODS) {
    const km = haversineKm(place, hood);
    if (!nearest || km < nearest.km) nearest = { id: hood.id, km };
  }
  if (nearest && nearest.km <= 1.6) return nearest.id;
  return null;
}

export function focusHoodId(focusArea?: string | null): string | null {
  if (!focusArea) return null;
  const key = focusArea.trim().toLowerCase();
  if (!key || key === 'any' || key === 'surprise') return null;
  if (FOCUS_TO_HOOD[key]) return FOCUS_TO_HOOD[key];
  const direct = HOODS.find((hood) => hood.id === key || hood.label.toLowerCase() === key || hood.aliases.includes(key));
  return direct?.id ?? null;
}

export function hoodLabel(ids: string[]): string {
  return ids.map((id) => hoodById(id)?.label ?? id).join(' & ');
}
