export type AreaOption = {
  label: string;
  value: string;
};

/**
 * User-facing area options. Values are stored in normalized, lowercase form.
 */
export const AREA_OPTIONS: AreaOption[] = [
  { label: 'All of NYC', value: 'any' },
  { label: 'Upper West Side', value: 'upper west side' },
  { label: 'Upper East Side', value: 'upper east side' },
  { label: 'Central Park & Museum Mile', value: 'central park' },
  { label: 'Harlem', value: 'harlem' },
  { label: 'Midtown', value: 'midtown corridor' },
  { label: 'Flatiron & Chelsea', value: 'flatiron chelsea' },
  { label: 'SoHo & Nolita', value: 'soho nolita' },
  { label: 'West Village & Greenwich Village', value: 'west village greenwich village' },
  { label: 'Tribeca', value: 'tribeca' },
  { label: 'Lower East Side', value: 'lower east side' },
  { label: 'Chinatown', value: 'chinatown' },
  { label: 'FiDi & Downtown', value: 'fidi downtown' },
  { label: 'Brooklyn', value: 'brooklyn' },
  { label: 'Surprise me', value: 'surprise' },
];

/**
 * Mapping from a chosen focus area to the neighborhood keys that should be
 * considered "in-bounds" for planning. The first entry in each array should
 * be treated as the primary focus for scoring.
 */
const AREA_VALUE_TO_KEYS: Record<string, string[]> = {
  'upper west side': ['upper west side', 'central park', 'harlem'],
  'upper east side': ['upper east side', 'central park'],
  'central park': ['central park', 'upper west side', 'upper east side', 'midtown corridor'],
  harlem: ['harlem', 'upper west side', 'central park'],
  'midtown corridor': ['midtown corridor', 'flatiron chelsea', 'upper east side', 'central park'],
  'flatiron chelsea': ['flatiron chelsea', 'midtown corridor', 'soho nolita', 'west village greenwich village'],
  'soho nolita': ['soho nolita', 'west village greenwich village', 'lower east side', 'chinatown', 'tribeca'],
  tribeca: ['tribeca', 'soho nolita', 'fidi downtown', 'west village greenwich village'],
  'west village greenwich village': ['west village greenwich village', 'soho nolita', 'tribeca', 'lower east side'],
  'lower east side': ['lower east side', 'chinatown', 'soho nolita', 'west village greenwich village'],
  chinatown: ['chinatown', 'lower east side', 'soho nolita', 'fidi downtown'],
  'fidi downtown': ['fidi downtown', 'tribeca', 'chinatown'],
  brooklyn: ['brooklyn'],
};

const RANDOMABLE_VALUES = AREA_OPTIONS.map((opt) => normalizeAreaValue(opt.value))
  .filter((value): value is string => !!value && value !== 'surprise' && value !== 'any');

const TITLE_CASE_CACHE = new Map<string, string>();

export function normalizeAreaValue(raw?: string | null): string | null {
  if (raw == null) return null;
  const trimmed = `${raw}`.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'surprise me' || lower === 'random') return 'surprise';
  if (['all', 'all of nyc', 'any', 'anywhere', 'no preference'].includes(lower)) return 'any';
  return lower.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve the list of area keys that should count as "in focus" for the
 * provided selection. Returns an empty array when there is no preference.
 */
export function getFocusAreaKeys(selection?: string | null): string[] {
  const normalized = normalizeAreaValue(selection);
  if (!normalized || normalized === 'any' || normalized === 'surprise') return [];
  const mapped = AREA_VALUE_TO_KEYS[normalized];
  if (Array.isArray(mapped) && mapped.length) {
    return mapped;
  }
  return [normalized];
}

export function areaLabelForValue(value?: string | null): string | null {
  const normalized = normalizeAreaValue(value);
  if (!normalized) return null;
  const match = AREA_OPTIONS.find(
    (opt) => normalizeAreaValue(opt.value) === normalized
  );
  if (match) return match.label;

  if (TITLE_CASE_CACHE.has(normalized)) {
    return TITLE_CASE_CACHE.get(normalized)!;
  }
  const title = normalized
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  TITLE_CASE_CACHE.set(normalized, title);
  return title;
}

export function randomAreaValue(exclude: string[] = []): string {
  const excludeSet = new Set(
    exclude
      .map((value) => normalizeAreaValue(value))
      .filter((value): value is string => !!value)
  );
  const pool = RANDOMABLE_VALUES.filter((value) => !excludeSet.has(value));
  if (pool.length === 0) {
    return RANDOMABLE_VALUES[Math.floor(Math.random() * RANDOMABLE_VALUES.length)] ?? 'upper west side';
  }
  return pool[Math.floor(Math.random() * pool.length)]!;
}
