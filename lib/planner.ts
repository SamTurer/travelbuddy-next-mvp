// lib/planner.ts
// TravelBuddy itinerary planner (NYC-focused)
//
// Highlights
// - Segment-based scheduling around anchors (must-dos)
// - Vibe/category weighting + cuisine repetition dampening
// - Meal & daily food caps + dataset food-bias penalty
// - Neighborhood clustering + "no DUMBO-first" heuristic
// - External provider (LLM/web) for extra non-food variety
// - **HARD SKIP** if a candidate is likely closed during its would-be slot
// - **NEW:** We now enrich your base dataset w/ Google Places (hours + single-branch)
//          so the hard-skip works even for JSON items.
//
// Requires:
//   - lib/llm.ts: export async function formatTimelineWithLLM(stops, ctx)
//   - lib/geo.ts: export function travelMinutesBetween(from, to)
//   - lib/types.ts: export type Stop { time,title,location,description,url? }
//   - lib/providers/places.ts (previous step)
//   - lib/providers/hours.ts (Google Places lookups; optional but recommended)

import { formatTimelineWithLLM } from '@/lib/llm';
import { travelMinutesBetween, accurateTravelMinutesBetween } from '@/lib/geo';
import type { Stop as PlanStop } from '@/lib/types';
import { fetchExtraPlaces } from '@/lib/providers/places';
import { verifyPlaceHoursByName, resolveBestBranchForChain } from '@/lib/providers/hours';
import type { PlaceHours } from '@/lib/providers/hours';

/* ============================
   Types
============================ */

export type Pace = 'chill' | 'balanced' | 'max';

export type Place = {
  name: string;
  category?: string;
  neighborhood?: string;
  duration_min?: number;
  duration_max?: number;
  vibe_tags?: string[];
  energy_tags?: string[];
  description?: string;
  location?: string;
  url?: string;
  lat?: number;
  lng?: number;
  // Optional verified hours (from provider or enrichment)
  hours?: PlaceHours;
};

export type LockObj = {
  title: string;
  location?: string;
  description?: string;
  time?: string;
  start?: string;
  duration_min?: number;
  category?: string;
  url?: string;
};

type Inputs = {
  city: string;
  date: string; // ISO date (yyyy-mm-dd)
  vibes: string[];
  pace: Pace;
  locks?: Array<string | LockObj>;
};

type Scheduled = {
  title: string;
  location?: string;
  description: string;
  category?: string;
  startMin: number;
  endMin: number;
  isAnchor?: boolean;
  url?: string;
  travelMinFromPrev?: number;
  travelModeFromPrev?: 'walk' | 'transit';
  lat?: number;
  lng?: number;
};

type CandidateStop = {
  title: string;
  location?: string;
  description?: string;
  category: string;
  duration: number;
  url?: string;
  sourcePlaceName?: string;
  lat?: number;
  lng?: number;
};

/* ============================
   Day/time constants
============================ */

const BREAKFAST_EARLIEST_MIN = 9 * 60;
const BREAKFAST_LATEST_MIN   = 10 * 60;
const BRUNCH_START_MIN       = 11 * 60;
const BRUNCH_END_MIN         = 13 * 60;
const LUNCH_START_MIN        = 11 * 60 + 30;
const LUNCH_WINDOW_END       = 14 * 60;
const DINNER_START_MIN       = 18 * 60;
const AFTERNOON_START_MIN    = 13 * 60;
const AFTERNOON_END_MIN      = 17 * 60;
const GENERAL_ACTIVITY_START_MIN = 9 * 60;

const DAY_START_MIN = BREAKFAST_EARLIEST_MIN;
const DAY_END_MIN   = 22 * 60;
const FIVE_PM_MIN   = 17 * 60;

const DAYPART_WINDOWS: Record<string, [number, number]> = {
  breakfast: [BREAKFAST_EARLIEST_MIN, BREAKFAST_LATEST_MIN],
  morning:   [BREAKFAST_EARLIEST_MIN, 11 * 60],
  brunch:    [BRUNCH_START_MIN, BRUNCH_END_MIN],
  lunch:     [LUNCH_START_MIN, LUNCH_WINDOW_END],
  afternoon: [AFTERNOON_START_MIN, FIVE_PM_MIN],
  dinner:    [DINNER_START_MIN, 20 * 60 + 30],
  evening:   [17 * 60, 21 * 60 + 30],
  drinks:    [20 * 60, 23 * 60],
};

const CENTRAL_START_AREAS = [
  'West Village', 'Greenwich Village', 'SoHo', 'Lower Manhattan', 'Chelsea',
  'Flatiron', 'NoHo', 'Nolita', 'Union Square', 'Midtown',
  'East Village', 'Lower East Side', 'Upper West Side', 'Upper East Side'
];

const EARLY_START_CATEGORIES = new Set<string>([
  'breakfast','coffee','park','walk','museum','gallery','landmark','market'
]);

const VIBE_START_AREA_BOOST: Record<string, Record<string, number>> = {
  classic: {
    'midtown': 1.6,
    'lower manhattan': 1.2,
    'upper east side': 1.0,
    'upper west side': 0.9,
    'chelsea': 0.6
  },
  curator: {
    'chelsea': 1.6,
    'soho': 1.2,
    'lower east side': 1.0,
    'midtown': 0.8,
    'upper east side': 0.8
  },
  local: {
    'west village': 1.4,
    'greenwich village': 1.2,
    'east village': 1.1,
    'lower east side': 1.0,
    'nolita': 0.8,
    'soho': 0.6
  },
};

const LOCAL_FAVORITE_CATEGORIES = new Set<string>(['coffee','brunch','market','walk','park','snack','shopping','bar','drinks']);
const START_OVERUSED_NAME_RE = /(dumbo|brooklyn bridge)/i;
const MIN_LUNCH_DURATION = 60;
const MIN_ANCHOR_DURATION = 60;
const SKIP_LUNCH_RE = /\b(skip|no)\s+lunch\b|\bfast(?:ing)?\b|\bintermittent\s+fast(?:ing)?\b/i;
const MINUTES_IN_DAY = 24 * 60;
const MINUTES_IN_WEEK = MINUTES_IN_DAY * 7;
const PACE_ACTIVITY_RANGE: Record<Pace, { min: number; max?: number }> = {
  chill: { min: 4, max: 6 },
  balanced: { min: 6, max: 8 },
  max: { min: 8, max: 10 }
};
const MAX_AREA_VISITS = 3;
const MAX_AREA_RUN = 2;
const AREA_BOUNCE_PENALTY = 28;
const TRAVEL_WEIGHT = 0.9;
const MAX_NON_ANCHOR_TRAVEL_MIN = 60;
const MAX_ANCHOR_TRAVEL_MIN = 120;
const MIN_FLEX_BLOCK_MIN = 20;
const LARGE_GAP_MIN = 75;
const NEIGHBORHOOD_LOCK_RUN = 5;

const BAR_CATEGORIES = new Set<string>(['bar','drinks','cocktails','wine bar','speakeasy','tavern','rooftop']);
const MEAL_CATEGORY_BASE = new Set<string>([
  'breakfast','brunch','lunch','dinner','dining','reservation','seafood','italian','french',
  'mediterranean','steakhouse','bbq','pizza','new-american','new american','american',
  'tapas','sushi','omakase','dinner-or-brunch','dinner or brunch'
]);
const MEAL_CATEGORY_REGEXES = [
  /\b(restaurant|trattoria|osteria|ristorante|brasserie|bistro)\b/i,
  /\b(italian|french|spanish|mexican|thai|korean|indian|japanese|chinese|vietnamese|mediterranean|israeli|greek|peruvian|omakase|sushi|ramen|noodle|yakitori|tapas|taqueria|cantina|steak|steakhouse|seafood|bbq|barbecue|american|new\s*american|prix[-\s]?fixe|tasting\s*menu)\b/i,
  /\b(brunch|lunch|dinner|supper)\b/i,
];
const MEAL_VIBE_TAGS = new Set<string>([
  'breakfast','brunch','lunch','dinner','reservation','tasting-menu','omakase','fine-dining',
  'chef\'s-table','prix-fixe','pre-theater','dinner-or-brunch','dinner or brunch'
]);

const VIBE_CATEGORY_WEIGHTS: Record<string, Partial<Record<string, number>>> = {
  classic: {
    landmark: -1.5,
    museum: -1.2,
    view: -0.9,
    park: -0.6,
    walk: -0.5,
    show: -0.5,
    market: -0.2,
    dinner: +0.3,
    bar: +0.4
  },
  curator: {
    museum: -1.4,
    gallery: -1.3,
    show: -0.7,
    shopping: -0.4,
    coffee: -0.3,
    brunch: -0.2,
    landmark: -0.2,
    dinner: +0.2,
    lunch: +0.2
  },
  local: {
    coffee: -1.0,
    breakfast: -0.9,
    brunch: -0.8,
    market: -0.8,
    lunch: -0.8,
    dinner: -0.6,
    snack: -0.6,
    walk: -0.6,
    park: -0.4,
    shopping: -0.4,
    bar: -0.5,
    landmark: +0.5,
    museum: +0.4
  },
};

const CUISINE_KEYS: Array<{key: string; re: RegExp}> = [
  { key: 'pizza',    re: /\b(pizza|slice)\b/i },
  { key: 'bagel',    re: /\b(bagel|bagels)\b/i },
  { key: 'italian',  re: /\b(italian|trattoria|osteria|ristorante|pasta)\b/i },
  { key: 'deli',     re: /\b(deli|pastrami|rye|katz)\b/i },
  { key: 'burger',   re: /\b(burger|smashburger)\b/i },
  { key: 'tacos',    re: /\b(taco|tacos|taqueria)\b/i },
  { key: 'coffee',   re: /\b(coffee|café|cafe|espresso|latte)\b/i },
  { key: 'dessert',  re: /\b(ice cream|gelato|cookie|dessert|bakery|pastry)\b/i },
];

const FOOD_CATEGORIES = new Set(['breakfast','brunch','lunch','dinner','snack','coffee','market']);
const MORNING_MEAL_CATEGORIES = new Set(['breakfast','brunch','coffee']);
const CATEGORY_COUNT_CAP: Record<string, number> = {
  breakfast: 1, brunch: 1, lunch: 1, dinner: 1, snack: 1, coffee: 1, market: 1, bar: 1, drinks: 1,
};
const DAILY_FOOD_CAP = 3;

const CATEGORY_DURATION_OVERRIDE: Record<string, number> = {
  breakfast: 45,
  brunch: 90,
  lunch: 60,
  dinner: 120,
  'quick bite': 30,
  'quick-bite': 30,
  shopping: 20,
};

const PACE_DURATION_MULTIPLIER: Record<Pace, { food: number; nonFood: number; coffee: number }> = {
  chill:    { food: 1.4, nonFood: 1.35, coffee: 1.2 },
  balanced: { food: 1.0, nonFood: 1.0, coffee: 1.0 },
  max:      { food: 0.8, nonFood: 0.7, coffee: 0.75 },
};

/* ============================
   Small helpers
============================ */

function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function minutesOf(dateISO: string, minSinceMidnight: number) {
  return new Date(`${dateISO}T00:00:00`).getTime() + minSinceMidnight * 60_000;
}

function parseClockMaybe(s?: string): number | null {
  if (!s) return null;
  const raw = s.trim();
  const m24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const mm = parseInt(m24[2], 10);
    return h * 60 + mm;
  }
  const m12 = raw.match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const mm = m12[2] ? parseInt(m12[2], 10) : 0;
    const ap = (m12[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h * 60 + mm;
  }
  return null;
}

function parseClockMaybeWithContext(s?: string, title?: string, description?: string): number | null {
  const raw = (s || '').trim();
  if (!raw) return null;
  const parsed = parseClockMaybe(raw);
  if (parsed != null) return parsed;

  const hourOnly = raw.match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
  if (!hourOnly) return null;

  let h = parseInt(hourOnly[1], 10);
  let mm = hourOnly[2] ? parseInt(hourOnly[2], 10) : 0;
  const t = `${title || ''} ${description || ''}`.toLowerCase();

  const isDinnerish = /\b(dinner|evening|tonight|show|broadway|concert|theatre|theater|drinks|cocktails?|bar|speakeasy)\b/.test(t);
  const isLunchish  = /\b(lunch|afternoon)\b/.test(t);
  const isBreakfast = /\b(breakfast|brunch|morning|bagel|coffee)\b/.test(t);

  if (isDinnerish) {
    if (h <= 11) h += 12;
    if (h < 17) h = Math.max(18, h);
  } else if (isLunchish) {
    if (h !== 12 && h < 8) h += 12;
  } else if (isBreakfast) {
    if (h === 12) h = 8;
    if (h > 12) h -= 12;
  } else {
    if (h <= 7) h += 12;
  }
  return h * 60 + mm;
}

function parseDaypartWords(s?: string): number | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/\bmidnight\b/.test(t)) return 0;
  if (/\bnoon\b/.test(t)) return 12 * 60;

  const map: Array<{ re: RegExp; key: keyof typeof DAYPART_WINDOWS }> = [
    { re: /\b(early\s+)?morning\b/, key: 'morning' },
    { re: /\bbrunch\b/, key: 'brunch' },
    { re: /\blunch\b/, key: 'lunch' },
    { re: /\bafternoon\b/, key: 'afternoon' },
    { re: /\bdinner\b/, key: 'dinner' },
    { re: /\b(evening|tonight)\b/, key: 'evening' },
    { re: /\b(drinks|cocktails?|speakeasy|bar)\b/, key: 'drinks' },
    { re: /\b(breakfast|bagel|bagels)\b/, key: 'breakfast' },
  ];

  for (const { re, key } of map) {
    if (re.test(t)) {
      const [lo, hi] = DAYPART_WINDOWS[key];
      return Math.round((lo + hi) / 2);
    }
  }
  return null;
}

function clampStartToDaypart(startMin: number, title?: string, description?: string): number {
  const t = `${title || ''} ${description || ''}`.toLowerCase();
  let window: [number, number] | null = null;

  for (const [key, range] of Object.entries(DAYPART_WINDOWS)) {
    if (new RegExp(`\\b${key}\\b`).test(t)) { window = range as [number, number]; break; }
  }
  if (!window) {
    if (/\bmorning\b/.test(t)) window = DAYPART_WINDOWS.morning;
    else if (/\bafternoon\b/.test(t)) window = DAYPART_WINDOWS.afternoon;
    else if (/\bevening\b|\btonight\b/.test(t)) window = DAYPART_WINDOWS.evening;
  }
  if (!window) return startMin;

  const [lo, hi] = window;
  if (startMin < lo) return lo;
  if (startMin > hi) return Math.min(Math.max(lo, startMin), hi);
  return startMin;
}

/* ============================
   Category/time heuristics
============================ */

function baseDuration(category?: string): number {
  const C = (category || '').toLowerCase();
  const table: Record<string, number> = {
    breakfast: 45, brunch: 90, coffee: 30, food: 60, lunch: 60, dinner: 120,
    bar: 60, drinks: 60, show: 120, museum: 90, gallery: 60,
    park: 75, walk: 60, shopping: 20, market: 60, landmark: 45, view: 45,
    snack: 25, 'quick bite': 30, 'quick-bite': 30, default: 60,
  };
  return table[C] ?? table.default;
}

function durationMultiplierFor(pace: Pace, category?: string | null): number {
  const cfg = PACE_DURATION_MULTIPLIER[pace];
  if (!cfg) return 1;
  const key = (category || '').toLowerCase();
  if (key === 'coffee') return cfg.coffee;
  if (isFoodCategory(key) || key === 'quick bite' || key === 'quick-bite') return cfg.food;
  return cfg.nonFood;
}

function minFor(category: string | undefined, pace: Pace) {
  const base = baseDuration(category);
  const multiplier = durationMultiplierFor(pace, category);
  return Math.max(MIN_FLEX_BLOCK_MIN, Math.round(base * multiplier));
}
function targetCount(pace: Pace, anchorCount: number) {
  const { min, max } = PACE_ACTIVITY_RANGE[pace];
  const baseline = max ?? (min + 2);
  return Math.max(anchorCount, baseline);
}
function defaultStartByCategory(category?: string, title?: string): number {
  const t = (title || '').toLowerCase();
  const c = (category || '').toLowerCase();
  if (/\bbrunch\b/.test(t)) return BRUNCH_START_MIN + 30;
  if (/\b(breakfast|bagel|bagels)\b/.test(t)) return 9 * 60;
  if (/\b(coffee|latte|espresso|cafe)\b/.test(t)) return 10 * 60 + 30;
  if (/\b(lunch|sandwich|slice|pizza|burger|deli|tacos)\b/.test(t)) return 12 * 60 + 30;
  if (/\b(dinner|tasting|omakase|reservation|rez|steak)\b/.test(t)) return 18 * 60 + 30;
  if (/\b(show|broadway|comedy|concert|theater|theatre)\b/.test(t)) return 19 * 60 + 30;
  if (/\b(bar|cocktail|speakeasy|wine)\b/.test(t)) return 21 * 60;
  const map: Record<string, number> = {
    breakfast: 9 * 60, brunch: BRUNCH_START_MIN + 30, coffee: 10 * 60 + 30, museum: 11 * 60, gallery: 15 * 60,
    walk: 14 * 60, park: 14 * 60, view: 16 * 60, lunch: 12 * 60 + 30,
    dinner: 18 * 60 + 30, show: 19 * 60 + 30, bar: 21 * 60, shopping: 16 * 60,
    market: 15 * 60, landmark: 14 * 60, snack: 16 * 60, default: 10 * 60,
  };
  return map[c] ?? map.default;
}
function inferCategoryFromName(name: string): string | undefined {
  const t = name.toLowerCase();
  if (/\b(for\s+dinner|dinner)\b/.test(t)) return 'dinner';
  if (/\b(for\s+lunch|lunch)\b/.test(t)) return 'lunch';
  if (/\b(for\s+breakfast|breakfast|brunch|bagel)\b/.test(t)) return 'breakfast';
  if (/\b(for\s+drinks|pre[-\s]?theatre|bar|speakeasy|cocktail|wine)\b/.test(t)) return 'bar';
  if (/\b(park|bryant park|central park|high line|highline)\b/.test(t)) return 'park';
  if (/\b(moma|metropolitan museum|the met|museum|gallery)\b/.test(t)) return /\bgallery\b/.test(t) ? 'gallery' : 'museum';
  if (/\b(library|nypl|public library)\b/.test(t)) return 'landmark';
  if (/\b(bridge|vessel|observatory|top of the rock|dumbo|view)\b/.test(t)) return 'view';
  if (/\b(soho|boutique|shopping|madison avenue|fifth avenue)\b/.test(t)) return 'shopping';
  if (/\b(coffee|cafe|espresso|latte)\b/.test(t)) return 'coffee';
  if (/\b(pizza|slice|burger|tacos|deli|katz)\b/.test(t)) return 'lunch';
  if (/\b(steak|omakase|tasting|trattoria|osteria|ristorante)\b/.test(t)) return 'dinner';
  if (/\b(bakery|cookie|levain|dessert|ice cream|gelato)\b/.test(t)) return 'snack';
  if (/\b(show|broadway|theater|theatre|comedy|concert)\b/.test(t)) return 'show';
  if (/\b(stroll|walk)\b/.test(t)) return 'walk';
  return undefined;
}
function normalizeLocks(raw?: Array<string | LockObj>): LockObj[] {
  if (!raw) return [];
  return raw.map((item) => (typeof item === 'string' ? { title: item, description: item } : item));
}
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function dedupePlaces(list: Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const item of list) {
    const key = normName(item.name || '');
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
function providerToPlace(p: {
  name: string;
  category?: string;
  neighborhood?: string;
  location?: string;
  duration_min?: number;
  description?: string;
  url?: string;
  vibe_tags?: string[];
  energy_tags?: string[];
  hours?: PlaceHours;
  lat?: number;
  lng?: number;
}): Place {
  return {
    name: p.name,
    category: p.category || 'walk',
    neighborhood: p.neighborhood || p.location,
    location: p.location || p.neighborhood,
    duration_min: typeof p.duration_min === 'number' ? p.duration_min : undefined,
    description: p.description,
    url: p.url,
    vibe_tags: p.vibe_tags,
    energy_tags: p.energy_tags,
    hours: p.hours,
    lat: typeof p.lat === 'number' ? p.lat : undefined,
    lng: typeof p.lng === 'number' ? p.lng : undefined,
  };
}
function areaKeyFromString(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.toLowerCase();
  if (!s.trim()) return null;
  if (/\b(multiple|various|several)\s+locations?\b/.test(s)) return null;
  s = s.replace(/\bnew york(?: city)?\b/g, '');
  s = s.replace(/\bnyc\b/g, '');
  const firstSplit = s.split(/[;/]/)[0] || s;
  const segment = firstSplit.split(',')[0].trim();
  const cleaned = segment.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned;
}
function areaKeyFromPlace(p: { neighborhood?: string; location?: string }): string | null {
  return areaKeyFromString(p.neighborhood) ?? areaKeyFromString(p.location);
}
function areaKeyFromStop(stop: { location?: string }): string | null {
  return areaKeyFromString(stop.location);
}
function recommendedTravelMode(minutes: number): 'walk' | 'transit' {
  if (!isFinite(minutes) || minutes <= 0) return 'walk';
  return minutes <= 17 ? 'walk' : 'transit';
}
function travelWithinLimit(minutes: number, destinationIsAnchor: boolean): boolean {
  if (!isFinite(minutes) || minutes <= 0) return true;
  if (destinationIsAnchor) return true;
  return minutes <= MAX_NON_ANCHOR_TRAVEL_MIN;
}
function ensureGoogleMapsUrl(url: string | undefined, location: string, title: string): string | undefined {
  if (url && /google\.(com|\w{2,})\/maps/i.test(url)) return url;
  const query = encodeURIComponent(`${title} ${location}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function mergeTransitNotes(polished: PlanStop[], rawWithNotes: PlanStop[]): PlanStop[] {
  const result: PlanStop[] = [];
  let polishedIdx = 0;
  for (const item of rawWithNotes) {
    if (item.title === 'TRANSIT_NOTE') {
      result.push({ time: '', title: 'Transit', location: '', description: item.description ?? '', url: undefined });
    } else if (polishedIdx < polished.length) {
      result.push(polished[polishedIdx++]);
    }
  }
  while (polishedIdx < polished.length) {
    result.push(polished[polishedIdx++]);
  }
  return result;
}
/* ============================
   Variety / scoring helpers
============================ */

function scorePlace(p: Place, category: string): number {
  let score = 0;
  const placeCat = (p.category || '').toLowerCase();
  const desiredCat = (category || '').toLowerCase();
  if (placeCat && placeCat !== desiredCat) {
    const bothBars = isBarCategory(placeCat) && isBarCategory(desiredCat);
    const bothMeals = isMealCategory(placeCat) && isMealCategory(desiredCat);
    if (!bothBars && !bothMeals) {
      score += 3.5;
    }
  }
  if (typeof p.duration_min !== 'number') score += 0.1;
  if (!p.neighborhood && !p.location) score += 0.15;
  return score;
}
function plannedDurationMinutes(place: Place, category: string, pace: Pace): number {
  const desired = (category || place.category || '').toLowerCase();
  const dataset = typeof place.duration_min === 'number' ? place.duration_min : undefined;
  const override = CATEGORY_DURATION_OVERRIDE[desired] ?? CATEGORY_DURATION_OVERRIDE[(place.category || '').toLowerCase()] ?? null;
  const datasetMax = typeof place.duration_max === 'number' ? place.duration_max : null;
  const baseDur = (() => {
    if (dataset != null) return dataset;
    if (override != null) return override;
    return baseDuration(desired || place.category);
  })();
  const multiplier = durationMultiplierFor(pace, desired);
  let target = Math.round(baseDur * multiplier);
  const minimum = minFor(desired || place.category, pace);
  if (datasetMax != null) target = Math.min(target, datasetMax);
  if (override != null) target = Math.min(target, override);
  target = Math.max(target, minimum, MIN_FLEX_BLOCK_MIN);
  return target;
}
function wouldExceedCategoryMinutesFactory(scheduled: Scheduled[]) {
  const capMinutes: Record<string, number> = {
    park: 120, walk: 120, museum: 150, gallery: 120,
    lunch: 90, dinner: 120, coffee: 60, bar: 120,
  };
  return (cat: string, addMin: number) => {
    const C = (cat || 'misc').toLowerCase();
    const current = scheduled
      .filter(s => (s.category || '').toLowerCase() === C)
      .reduce((acc, s) => acc + (s.endMin - s.startMin), 0);
    const cap = capMinutes[C];
    if (!cap) return false;
    return current + addMin > cap;
  };
}
function isLunchy(place: { name: string; category?: string }, cat: string): boolean {
  const c = (cat || '').toLowerCase();
  if (c === 'lunch') return true;
  const name = (place.name || '').toLowerCase();
  return /\b(pizza|slice|burger|sandwich|deli|tacos|ramen|noodles|poke|salad)\b/.test(name);
}
function wouldExceedCategoryCountsFactory(scheduled: Scheduled[]) {
  return (cat: string, vibes?: string[]) => {
    const key = (cat || 'misc').toLowerCase();
    const catCap = CATEGORY_COUNT_CAP[key];
    if (catCap != null) {
      const catCount = scheduled.filter(s => (s.category || '').toLowerCase() === key).length;
      if (catCount >= catCap) return true;
    }
    const isFoodForward = !!vibes?.some(v => /(local|classic)/i.test(v));
    if (!isFoodForward && isFoodCategory(key)) {
      if (dayFoodCount(scheduled) >= DAILY_FOOD_CAP) return true;
    }
    return false;
  };
}

/** Light non-food filler if we want to avoid increasing food count */
function makeNonFoodFillerStop(loc: string, vibes: string[] | undefined, pace: Pace): CandidateStop {
  const wantsCurator = !!vibes?.some(v => /curator/i.test(v));
  const wantsClassic = !!vibes?.some(v => /classic/i.test(v));
  const wantsLocal = !!vibes?.some(v => /local/i.test(v));

  if (wantsCurator) {
    return {
      title: 'Pop into a nearby gallery',
      location: loc,
      description: 'Take in a design-forward space between stops.',
      category: 'gallery',
      duration: pace === 'max' ? 45 : 60,
    };
  }
  if (wantsClassic) {
    return {
      title: 'Visit a nearby landmark',
      location: loc,
      description: 'Hit an iconic sight while you are close.',
      category: 'landmark',
      duration: pace === 'max' ? 45 : 60,
    };
  }
  if (wantsLocal) {
    return {
      title: 'Explore the neighborhood',
      location: loc,
      description: 'Wander the side streets and soak up the local energy.',
      category: 'walk',
      duration: pace === 'max' ? 45 : 60,
    };
  }
  const options: Array<CandidateStop> = [
    {
      title: 'Browse a nearby gallery',
      location: loc,
      description: 'Slip into an independent gallery for a quick look around.',
      category: 'gallery',
      duration: 45,
    },
    {
      title: 'Window-shop local boutiques',
      location: loc,
      description: 'Check out a design or concept store within a few blocks.',
      category: 'shopping',
      duration: 30,
    },
    {
      title: 'Take a park breather',
      location: loc,
      description: 'Find a bench, people-watch, and recharge outdoors.',
      category: 'park',
      duration: pace === 'max' ? 35 : 50,
    },
    {
      title: 'Neighborhood walkabout',
      location: loc,
      description: 'Stretch your legs with a relaxed stroll nearby.',
      category: 'walk',
      duration: pace === 'max' ? 40 : 55,
    },
  ];
  const idx = hashString(loc) % options.length;
  return options[idx];
}

function shouldSkipLunch(locks: LockObj[]): boolean {
  return locks.some(lock => {
    const text = `${lock.title || ''} ${lock.description || ''}`.toLowerCase();
    return SKIP_LUNCH_RE.test(text);
  });
}

function overlapsWindow(startMin: number, endMin: number, windowStart: number, windowEnd: number): boolean {
  return endMin > windowStart && startMin < windowEnd;
}

function preferredStartArea(
  city: string,
  anchors: Scheduled[],
  dataset: Place[],
  opts?: { date?: string; vibes?: string[] }
): string {
  const morningAnchor = anchors.find(a => a.startMin <= (11 * 60 + 30));
  if (morningAnchor) return (morningAnchor.location || morningAnchor.title || city);

  const areaStats = CENTRAL_START_AREAS.map(area => {
    const areaLower = area.toLowerCase();
    let total = 0;
    let early = 0;
    for (const place of dataset) {
      const loc = (place.neighborhood || place.location || '').toLowerCase();
      if (!loc.includes(areaLower)) continue;
      total += 1;
      const cat = (place.category || '').toLowerCase();
      if (EARLY_START_CATEGORIES.has(cat)) early += 1;
    }
    return { area, areaLower, total, early };
  }).filter(stat => stat.total > 0);

  if (!areaStats.length) return '';

  const vibeBoost = new Map<string, number>();
  if (opts?.vibes?.length) {
    for (const vibe of opts.vibes) {
      const boostMap = VIBE_START_AREA_BOOST[vibe.toLowerCase()];
      if (!boostMap) continue;
      for (const [areaLower, boost] of Object.entries(boostMap)) {
        vibeBoost.set(areaLower, (vibeBoost.get(areaLower) ?? 0) + boost);
      }
    }
  }

  const weighted = areaStats
    .map(stat => {
      let weight = stat.early > 0 ? stat.early * 1.25 : 0.5;
      weight += stat.total * 0.1;
      weight += vibeBoost.get(stat.areaLower) ?? 0;
      return { area: stat.area, weight };
    })
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.area.localeCompare(b.area);
    });

  if (!weighted.length) return '';
  if (weighted.length === 1) return weighted[0].area;

  const seedSource = opts?.date ? opts.date : (opts?.vibes?.join('|') || '');
  if (!seedSource) return weighted[0].area;

  const topSlice = weighted.slice(0, Math.min(weighted.length, 3));
  const idx = hashString(seedSource) % topSlice.length;
  return topSlice[idx].area;
}
function startAreaPenalty(
  place: Place,
  preferredArea: string,
  currentLocation: string,
  scheduledCount: number,
  opts?: { category?: string; startAreaAvailability?: Map<string, number> }
): number {
  const loc = (place.neighborhood || place.location || '').toLowerCase();
  const pref = (preferredArea || '').toLowerCase();
  const cur = (currentLocation || '').toLowerCase();

  let penalty = 0;
  const isInPreferred = pref && loc.includes(pref);
  const isNearCurrent = cur && (loc.includes(cur) || cur.includes(loc));
  if (!pref) return 0;

  const catKey = opts?.category?.toLowerCase();
  const availableInPreferred = catKey ? opts?.startAreaAvailability?.get(catKey) ?? null : null;

  const base =
    scheduledCount === 0 ? 1.5 :
    scheduledCount === 1 ? 0.8 :
    scheduledCount === 2 ? 0.4 : 0;

  if (base > 0 && !isInPreferred) {
    let scaled = base;
    if (scheduledCount > 0 && isNearCurrent) {
      scaled *= 0.5;
    }
    if (availableInPreferred != null) {
      if (availableInPreferred <= 1) {
        scaled *= 0.35;
      } else if (availableInPreferred === 2) {
        scaled *= 0.6;
      }
    }
    penalty += scaled;
  }
  return penalty;
}
function localVibeBoost(vibes: string[] | undefined, category?: string): number {
  if (!vibes || !category) return 0;
  if (!vibes.some(v => /local/i.test(v))) return 0;
  return LOCAL_FAVORITE_CATEGORIES.has(category.toLowerCase()) ? -0.6 : 0;
}
function vibeCategoryBias(vibes: string[] | undefined, category?: string): number {
  if (!vibes || !category) return 0;
  const c = category.toLowerCase();
  let total = 0;
  for (const v of vibes) {
    const map = VIBE_CATEGORY_WEIGHTS[v.toLowerCase()];
    if (map && map[c] != null) total += map[c]!;
  }
  return total;
}
function cuisineKeyFromPlace(p: Place | { name: string }): string | null {
  const name = p.name || '';
  for (const {key, re} of CUISINE_KEYS) {
    if (re.test(name)) return key;
  }
  return null;
}
function cuisineRepeatPenalty(p: Place, cuisineCounts: Map<string, number>, vibes: string[] | undefined): number {
  const ck = cuisineKeyFromPlace(p);
  if (!ck) return 0;
  const count = cuisineCounts.get(ck) || 0;
  const isFoodForward = !!vibes?.some(v => /(local|classic)/i.test(v));
  if (count === 0) return 0;
  if (count === 1) return isFoodForward ? 0.2 : 0.8;
  return isFoodForward ? 0.6 : 1.6;
}
function dumboStartPenalty(place: Place, scheduledCount: number, vibes: string[] | undefined): number {
  if (scheduledCount > 0) return 0;
  if (!START_OVERUSED_NAME_RE.test(place.name)) return 0;
  const wantsViews = !!vibes?.some(v => /(view|photography|skyline)/i.test(v));
  return wantsViews ? 0 : 1.5;
}
function isBarCategory(cat?: string): boolean {
  if (!cat) return false;
  return BAR_CATEGORIES.has(cat.toLowerCase());
}
function isMealCategory(category?: string, place?: { category?: string; vibe_tags?: string[] }): boolean {
  const c = (category || place?.category || '').toLowerCase();
  if (!c) return false;
  if (MEAL_CATEGORY_BASE.has(c)) return true;
  if (MEAL_CATEGORY_REGEXES.some(re => re.test(c))) return true;
  if (place?.vibe_tags?.some(tag => MEAL_VIBE_TAGS.has(tag.toLowerCase()))) return true;
  return false;
}
function isMorningMealCategory(category?: string, place?: { category?: string; vibe_tags?: string[] }): boolean {
  const c = (category || place?.category || '').toLowerCase();
  if (MORNING_MEAL_CATEGORIES.has(c)) return true;
  if (place?.vibe_tags?.some(tag => MORNING_MEAL_CATEGORIES.has(tag.toLowerCase()))) return true;
  return false;
}
function isFoodCategory(cat?: string): boolean {
  if (!cat) return false;
  return FOOD_CATEGORIES.has(cat.toLowerCase());
}
function dayFoodCount(scheduled: Scheduled[]): number {
  return scheduled.reduce((n, s) => n + (isFoodCategory(s.category) ? 1 : 0), 0);
}
function datasetFoodBiasPenalty(candidates: Place[], vibes?: string[], cat?: string): number {
  if (!cat || isFoodCategory(cat) === false) return 0;
  const isFoodForward = !!vibes?.some(v => /(local|classic)/i.test(v));
  if (isFoodForward) return 0;
  const total = Math.max(1, candidates.length);
  const foodItems = candidates.filter(p => isFoodCategory(p.category)).length;
  const share = foodItems / total;
  return share > 0.5 ? (share - 0.5) * 1.5 : 0;
}
function repetitionPenalty(place: { name: string; category?: string }, categoryCounts: Map<string, number>, usedNameKeys: Set<string>): number {
  let penalty = 0;
  const key = normName(place.name);
  if (usedNameKeys.has(key)) penalty += 3.0;

  const cat = (place.category || 'misc').toLowerCase();
  const count = categoryCounts.get(cat) || 0;
  if (count >= 2) penalty += 1.2;
  else if (count >= 1) penalty += 0.4;

  return penalty;
}

/* ============================
   NEW: Hours/branch enrichment
============================ */

function isGenericArea(text?: string | null): boolean {
  if (!text) return true;
  const cleaned = text.trim().toLowerCase();
  if (!cleaned) return true;
  if (
    cleaned === 'multiple' ||
    cleaned === 'multiple location' ||
    cleaned === 'multiple locations' ||
    cleaned === 'one location'
  ) {
    return true;
  }
  return /\b(multiple|various|several)\s+locations?\b/.test(cleaned);
}

function sanitizeAreaText(text?: string | null): string | undefined {
  if (!text) return undefined;
  const cleaned = text.trim();
  if (!cleaned) return undefined;
  if (isGenericArea(cleaned)) return undefined;
  return cleaned;
}

function stripMultipleLocations(text?: string): string | undefined {
  if (!text) return text;
  return text.replace(/\s+/g, ' ').trim();
}

function resolveDisplayLocation(location: string | undefined, fallback: string, alternate?: string): string {
  const primary = sanitizeAreaText(location);
  if (primary) return primary;
  const secondary = sanitizeAreaText(alternate);
  if (secondary) return secondary;
  return fallback;
}

async function enrichMissingHoursFor(
  list: Place[],
  city: string,
  areaHint?: string,
  maxLookups = 50
): Promise<void> {
  const candidates = [...list]
    .sort((a, b) => (a.name.length - b.name.length))
    .slice(0, Math.min(maxLookups, list.length));

  await Promise.all(
    candidates.map(async (p) => {
      if (p.neighborhood !== undefined) p.neighborhood = sanitizeAreaText(p.neighborhood);
      if (p.location !== undefined) p.location = sanitizeAreaText(p.location);

      const hasHours = !!(p.hours?.weekdayText?.length || p.hours?.periods?.length);
      const hasArea  = !!(p.neighborhood || p.location);

      // Resolve a single branch for chains if area not set
      if (!hasArea) {
        try {
          const best = await resolveBestBranchForChain(p.name, city, areaHint);
          if (best) {
            if (!p.neighborhood && best.neighborhood) p.neighborhood = best.neighborhood;
            if (!p.location && (best.address || best.neighborhood)) {
              p.location = best.address || best.neighborhood;
            }
            if (best.lat != null && best.lng != null) {
              p.lat = best.lat;
              p.lng = best.lng;
            }
          }
        } catch {}
      }

      // Look up hours if missing
      if (!hasHours) {
        try {
          const { hours, website, bestBranch } = await verifyPlaceHoursByName(p.name, city);
          if (hours && (hours.weekdayText?.length || hours.periods?.length || typeof hours.openNow === 'boolean')) {
            p.hours = {
              ...(p.hours || {}),
              weekdayText: hours.weekdayText ?? p.hours?.weekdayText,
              periods: hours.periods ?? p.hours?.periods,
              openNow: hours.openNow ?? p.hours?.openNow,
            };
          }
          if (website && !p.url) p.url = website;
          if (bestBranch) {
            if (!p.neighborhood && bestBranch.neighborhood) p.neighborhood = bestBranch.neighborhood;
            if ((!p.location || isGenericArea(p.location)) && (bestBranch.address || bestBranch.neighborhood)) {
              p.location = bestBranch.address || bestBranch.neighborhood;
            }
            if (bestBranch.lat != null && bestBranch.lng != null) {
              p.lat = bestBranch.lat;
              p.lng = bestBranch.lng;
            }
          }
        } catch {
          // ignore
        }
      }

      // Clean up “multiple locations”
      p.description = stripMultipleLocations(p.description);
      if (!p.location && p.neighborhood) {
        p.location = p.neighborhood;
      }
    })
  );
}

/* ============================
   Main planner
============================ */

export async function plan(inputs: Inputs, dataset: Place[]): Promise<PlanStop[]> {
  const paceRange = PACE_ACTIVITY_RANGE[inputs.pace];
  const maxStops = paceRange.max ?? Number.POSITIVE_INFINITY;

  const { city, date, vibes, pace } = inputs;
  const locks = normalizeLocks(inputs.locks);
  const skipLunch = shouldSkipLunch(locks);
  const cityAreaKey = areaKeyFromString(city);
  const anchorAreaKeys = new Set<string>();
  const dateObj = new Date(`${date}T00:00:00`);
  const isWeekend = !Number.isNaN(dateObj.getTime()) ? (dateObj.getDay() === 0 || dateObj.getDay() === 6) : false;
  let brunchChosen = false;
  let lunchChosen = false;

  const markMealScheduled = (cat?: string | null) => {
    const key = (cat || '').toLowerCase();
    if (!key) return;
    if (key === 'brunch') brunchChosen = true;
    if (key === 'lunch') lunchChosen = true;
  };

  function registerStop(stop: Scheduled, sourcePlace?: Place) {
    markMealScheduled(stop.category);
    if (sourcePlace) {
      if (stop.lat == null && typeof sourcePlace.lat === 'number') stop.lat = sourcePlace.lat;
      if (stop.lng == null && typeof sourcePlace.lng === 'number') stop.lng = sourcePlace.lng;
    }
    if ((stop.lat == null || stop.lng == null)) {
      const datasetSource = placeByName.get(normName(stop.title));
      if (datasetSource) {
        if (stop.lat == null && typeof datasetSource.lat === 'number') stop.lat = datasetSource.lat;
        if (stop.lng == null && typeof datasetSource.lng === 'number') stop.lng = datasetSource.lng;
      }
    }
    registerAreaForStop(stop);
    const areaKey = areaKeyFromStop(stop);
    if (areaKey) {
      neighborhoodLockCounts.set(areaKey, 1 + (neighborhoodLockCounts.get(areaKey) || 0));
      advanceAreaLock(areaKey);
    }
    const catKey = (stop.category || 'misc').toLowerCase();
    categoryCounts.set(catKey, 1 + (categoryCounts.get(catKey) || 0));
    usedNameKeys.add(normName(stop.title));
    const ck = sourcePlace ? cuisineKeyFromPlace(sourcePlace) : cuisineKeyFromPlace({ name: stop.title });
    if (ck) cuisineCounts.set(ck, 1 + (cuisineCounts.get(ck) || 0));
  }

  // Candidate pool by vibes (deduped; fallback to all)
  let candidates = dataset;
  if (vibes?.length) {
    candidates = dataset.filter(
      (p) =>
        (p.vibe_tags || []).some((v) => vibes.includes(v)) ||
        (p.energy_tags || []).some((v) => vibes.includes(v)),
    );
    if (candidates.length === 0) candidates = dataset;
  }
  candidates = dedupePlaces(candidates);

  const placeByName = new Map<string, Place>();
  for (const place of dataset) {
    const key = normName(place.name);
    if (!placeByName.has(key)) {
      placeByName.set(key, place);
    }
  }

  // Build anchors from locks
  const anchors: Scheduled[] = locks.map((l) => {
    const title = (l.title || '').trim();
    const tLC = title.toLowerCase();
    const match = dataset.find((p) => (p.name || '').toLowerCase().includes(tLC)) || null;

    const hintedCategory = l.category;
    const inferredFromName = inferCategoryFromName(title) ?? inferCategoryFromName(l.description || '');
    const category = hintedCategory ?? match?.category ?? inferredFromName ?? 'custom';

    const explicit =
      parseClockMaybeWithContext(l.time, l.title, l.description) ??
      parseClockMaybeWithContext(l.start, l.title, l.description) ??
      parseDaypartWords(l.title) ??
      parseDaypartWords(l.description);

    let startMin = explicit ?? defaultStartByCategory(category, title);
    startMin = clampStartToDaypart(startMin, l.title, l.description);

    const hintedDuration = l.duration_min;
    const duration = Math.max(hintedDuration ?? 0, minFor(category, pace), MIN_ANCHOR_DURATION);

    const loc = l.location || match?.location || match?.neighborhood || city;
    const desc = l.description || match?.description || 'User must-do';
    const url = l.url || match?.url || undefined;

    const anchorArea = areaKeyFromString(loc);
    if (anchorArea && anchorArea !== cityAreaKey) {
      anchorAreaKeys.add(anchorArea);
    }

    return {
      title: title || (match?.name ?? 'Must-do'),
      category,
      location: loc,
      description: desc ?? '',
      startMin,
      endMin: startMin + duration,
      isAnchor: true,
      url,
      lat: match?.lat,
      lng: match?.lng,
    };
  });

  for (const anchor of anchors) {
    markMealScheduled(anchor.category);
  }

  anchors.sort((a, b) => a.startMin - b.startMin);

  const hasDinnerAnchor = anchors.some(a => (a.category || '').toLowerCase() === 'dinner');

  const earliestAnchorStart = anchors.length ? Math.min(...anchors.map(a => a.startMin)) : Number.POSITIVE_INFINITY;
  const dayStartMin = earliestAnchorStart < DAY_START_MIN ? earliestAnchorStart : DAY_START_MIN;

  // Fuzzy names to avoid dupes with anchors
  const anchorNameKeys = new Set<string>();
  for (const a of anchors) {
    anchorNameKeys.add(normName(a.title));
    const cleaned = a.title.replace(/\bin the (morning|afternoon|evening)\b/i, '');
    anchorNameKeys.add(normName(cleaned));
  }

  // Suggestions stream (no exact anchor duplicates)
  let suggestionStream = candidates.filter((c) => !anchorNameKeys.has(normName(c.name)));
  shuffleInPlace(suggestionStream);

  const areaAvailability = new Map<string, number>();
  for (const place of suggestionStream) {
    const areaKey = areaKeyFromPlace(place);
    if (!areaKey || areaKey === cityAreaKey) continue;
    areaAvailability.set(areaKey, 1 + (areaAvailability.get(areaKey) || 0));
  }

  const preferredArea = preferredStartArea(city, anchors, candidates, { date, vibes });

  const anchorPlacesForEnrichment = anchors
    .map(anchor => placeByName.get(normName(anchor.title)))
    .filter((p): p is Place => !!p);

  // 🔧 NEW: enrich base dataset with hours/branch so hard-skip can work
  await enrichMissingHoursFor(
    dedupePlaces([...suggestionStream, ...anchorPlacesForEnrichment]),
    city,
    preferredArea,
    Math.max(120, suggestionStream.length + anchorPlacesForEnrichment.length)
  );

  for (const anchor of anchors) {
    const source = placeByName.get(normName(anchor.title));
    if (!source) continue;
    if (anchor.lat == null && typeof source.lat === 'number') anchor.lat = source.lat;
    if (anchor.lng == null && typeof source.lng === 'number') anchor.lng = source.lng;
    if (!anchor.url && source.url) anchor.url = source.url;
  }

  const coffeePlaces = dataset.filter(p => (p.category || '').toLowerCase() === 'coffee');
  const lunchPlaces = dataset.filter(p => (p.category || '').toLowerCase() === 'lunch');
  const dinnerPlaces = dataset.filter(p => (p.category || '').toLowerCase() === 'dinner');
  function pickCoffeeCandidate(baseLoc: string): CandidateStop | null {
    const baseArea = areaKeyFromString(baseLoc);
    const prevDistinct = previousDistinctArea(baseArea);
    let best: Place | null = null;
    let bestScore = Infinity;
    for (const place of coffeePlaces) {
      const key = normName(place.name);
      if (usedNameKeys.has(key)) continue;
      const area = areaKeyFromPlace(place);
      if (area && !anchorAreaKeys.has(area) && (scheduledAreaCounts.get(area) || 0) >= MAX_AREA_VISITS) {
        continue;
      }
      let score = 0;
      if (baseArea && area) {
        if (baseArea !== area) score += 3.2;
      } else if (!area) {
        score += 1.5;
      }
      const travel = minutesTravel(baseLoc, place.location || place.neighborhood || city);
      if (!travelWithinLimit(travel, false)) continue;
      score += travel / 6;
      if (area && scheduled.length >= 2) {
        const visits = scheduledAreaCounts.get(area) || 0;
        if (visits >= 2) score += visits * 4.5 + 4;
        else if (visits >= 1) score += visits * 2.5;
        const run = recentAreaRunLength(area);
        if (run >= 1) score += (run + 1) * 3.0;
      }
      score += areaVisitPenalty(area);
      if (area && prevDistinct && area === prevDistinct) {
        score += AREA_BOUNCE_PENALTY;
      }
      if (score < bestScore) {
        bestScore = score;
        best = place;
      }
    }
    if (!best) return null;
    const duration = Math.max(25, best.duration_min ?? 30);
   const location = best.location || best.neighborhood || baseLoc;
   return {
     title: best.name,
     location,
     description: best.description ?? 'Grab a great cup of coffee nearby.',
     category: best.category || 'coffee',
     duration,
     url: ensureGoogleMapsUrl(best.url, location, best.name),
      lat: best.lat,
      lng: best.lng,
   };
 }

  function pickLunchCandidate(baseLoc: string): Place | null {
    const baseArea = areaKeyFromString(baseLoc);
    const prevDistinct = previousDistinctArea(baseArea);
    let best: Place | null = null;
    let bestScore = Infinity;
    for (const place of lunchPlaces) {
      const key = normName(place.name);
      if (usedNameKeys.has(key)) continue;
      const area = areaKeyFromPlace(place);
      if (area && !anchorAreaKeys.has(area) && (scheduledAreaCounts.get(area) || 0) >= MAX_AREA_VISITS) {
        continue;
      }
      let score = 0;
      if (baseArea && area) {
        if (baseArea !== area) score += 3.5;
      } else if (!area) {
        score += 2.5;
      }
      const travel = minutesTravel(baseLoc, place.location || place.neighborhood || city);
      if (!travelWithinLimit(travel, false)) continue;
      score += travel / 4;
      if (area && scheduled.length >= 2) {
        const visits = scheduledAreaCounts.get(area) || 0;
        if (visits >= 2) score += visits * 5.5 + 6;
        else if (visits >= 1) score += visits * 3.0;
        const run = recentAreaRunLength(area);
        if (run >= 1) score += (run + 1) * 3.5;
      }
      score += areaVisitPenalty(area);
      if (area && prevDistinct && area === prevDistinct) {
        score += AREA_BOUNCE_PENALTY;
      }
      if (score < bestScore) {
        bestScore = score;
        best = place;
      }
    }
    if (!best) {
      best = lunchPlaces.find(p => {
        if (usedNameKeys.has(normName(p.name))) return false;
        const travel = minutesTravel(baseLoc, p.location || p.neighborhood || city);
        return travelWithinLimit(travel, false);
      }) || null;
    }
    return best || null;
  }

  function pickDinnerCandidate(baseLoc: string): Place | null {
    const baseArea = areaKeyFromString(baseLoc);
    const prevDistinct = previousDistinctArea(baseArea);
    let best: Place | null = null;
    let bestScore = Infinity;
    for (const place of dinnerPlaces) {
      const key = normName(place.name);
      if (usedNameKeys.has(key)) continue;
      const area = areaKeyFromPlace(place);
      if (area && !anchorAreaKeys.has(area) && (scheduledAreaCounts.get(area) || 0) >= MAX_AREA_VISITS) {
        continue;
      }
      let score = 0;
      if (baseArea && area) {
        if (baseArea !== area) score += 3.0;
      } else if (!area) {
        score += 2.0;
      }
      const travel = minutesTravel(baseLoc, place.location || place.neighborhood || city);
      if (!travelWithinLimit(travel, false)) continue;
      score += travel / 4;
      if (area && scheduled.length >= 3) {
        const visits = scheduledAreaCounts.get(area) || 0;
        if (visits >= 2) score += visits * 6 + 8;
        else if (visits >= 1) score += visits * 3.0;
        const run = recentAreaRunLength(area);
        if (run >= 1) score += (run + 1) * 5.0;
      }
      score += areaVisitPenalty(area);
      if (area && prevDistinct && area === prevDistinct) {
        score += AREA_BOUNCE_PENALTY;
      }
      if (score < bestScore) {
        bestScore = score;
        best = place;
      }
    }
    if (!best) {
      best = dinnerPlaces.find(p => {
        if (usedNameKeys.has(normName(p.name))) return false;
        const travel = minutesTravel(baseLoc, p.location || p.neighborhood || city);
        return travelWithinLimit(travel, false);
      }) || null;
    }
    return best || null;
  }

  function buildFillerCandidate(baseLoc: string, avoidFoodNow: boolean, lastStop?: Scheduled): CandidateStop | null {
    const lastWasFood = lastStop ? isFoodCategory(lastStop.category) : false;
    const coffeeCapReached = (categoryCounts.get('coffee') || 0) >= (CATEGORY_COUNT_CAP.coffee ?? Infinity);
    const shouldSkipCoffee = avoidFoodNow || lastWasFood || coffeeCapReached;

    if (!shouldSkipCoffee) {
      const coffee = pickCoffeeCandidate(baseLoc);
      if (coffee) return coffee;
    }
    const wantsNonFood = avoidFoodNow || lastWasFood || !!vibes?.some(v => /(classic|curator|local)/i.test(v));
    if (wantsNonFood) {
      const place = takeNearbyNonFoodPlace(baseLoc);
      if (place) {
        const baseDurationGuess = place.duration_min ?? baseDuration(place.category);
        const maxDurationGuess = place.duration_max ?? baseDurationGuess;
        const durationGuess = Math.min(baseDurationGuess, maxDurationGuess);
        return {
          title: place.name,
          location: place.location || place.neighborhood || baseLoc,
          description: place.description ?? 'Worth a stop nearby.',
          category: place.category || 'walk',
          duration: durationGuess,
          url: place.url,
          sourcePlaceName: place.name,
          lat: place.lat,
          lng: place.lng,
        };
      }
      return makeNonFoodFillerStop(baseLoc, vibes, pace);
    }
    return {
      title: 'Explore the neighborhood',
      location: baseLoc,
      description: 'Take a relaxed walk between sights.',
      category: 'walk',
      duration: pace === 'max' ? 45 : 60,
    };
  }

  function removeFromSuggestionStream(place: Place) {
    const key = normName(place.name);
    suggestionStream = suggestionStream.filter(p => normName(p.name) !== key);
  }

  function removePlaceByName(name: string) {
    const key = normName(name);
    suggestionStream = suggestionStream.filter(p => normName(p.name) !== key);
  }

  function takeNearbyNonFoodPlace(baseLoc: string): Place | null {
    const baseArea = areaKeyFromString(baseLoc);
    let best: { place: Place; score: number } | null = null;

    for (const place of suggestionStream) {
      const catKey = (place.category || '').toLowerCase();
      if (!catKey) continue;
      if (isFoodCategory(catKey) || catKey === 'coffee' || catKey === 'breakfast') continue;

      const travel = minutesTravel(baseLoc, place.location || place.neighborhood || city);
      if (!travelWithinLimit(travel, false)) continue;

      let score = travel;
      const area = areaKeyFromPlace(place);
      if (baseArea && area && baseArea !== area) score += 12;

      if (!best || score < best.score) {
        best = { place, score };
      }
    }

    return best ? best.place : null;
  }

  function buildScheduledStopBetween(prev: Scheduled, next: Scheduled | null, place: Place): Scheduled | null {
    const targetLoc = place.location || place.neighborhood || city;
    const travelIn = minutesTravel(prev.location || city, targetLoc);
    if (!travelWithinLimit(travelIn, !!prev.isAnchor)) return null;
    const travelOut = next ? minutesTravel(targetLoc, next.location || city) : 0;
    if (!travelWithinLimit(travelOut, !!next?.isAnchor)) return null;

    const windowEnd = next ? next.startMin : DAY_END_MIN;
    const available = windowEnd - (prev.endMin + travelIn) - travelOut;
    if (available < MIN_FLEX_BLOCK_MIN) return null;

    const desired = (place.category || '').toLowerCase();
    const duration = Math.min(available, plannedDurationMinutes(place, desired, pace));
    if (duration < MIN_FLEX_BLOCK_MIN) return null;

    const startMin = prev.endMin + travelIn;
    const endMin = startMin + duration;

    const stop: Scheduled = {
      title: place.name,
      location: targetLoc,
      description: place.description ?? 'Worth a stop nearby.',
      category: place.category || 'walk',
      startMin,
      endMin,
      url: ensureGoogleMapsUrl(place.url, targetLoc, place.name),
      travelMinFromPrev: travelIn,
      travelModeFromPrev: recommendedTravelMode(travelIn),
      lat: place.lat,
      lng: place.lng,
    };
    return stop;
  }

  async function ensureExtraCandidates(areaHint?: string) {
    try {
      const extra = await fetchExtraPlaces({
        city,
        vibes,
        neighborhoodsHint: areaHint || preferredArea,
        excludeNames: Array.from(anchorNameKeys),
        wantCategories: ['park','walk','view','landmark','museum','gallery','market','shopping'],
        limit: 8,
      });
      if (Array.isArray(extra) && extra.length) {
        const converted = extra.map(providerToPlace);
        suggestionStream = dedupePlaces([...suggestionStream, ...converted]);
      }
    } catch {
      // ignore fetch failures
    }
  }

  function tryGapPool(
    pool: Place[],
    prev: Scheduled,
    next: Scheduled | null,
    gapMinutes: number
  ): { scheduled: Scheduled; place: Place; score: number } | null {
    let best: { scheduled: Scheduled; place: Place; score: number } | null = null;
    for (const place of pool) {
      const placeLoc = place.location || place.neighborhood || city;
      const travelIn = minutesTravel(prev.location || city, placeLoc);
      if (!travelWithinLimit(travelIn, !!prev.isAnchor)) continue;
      const travelOut = next ? minutesTravel(placeLoc, next.location || city) : 0;
      if (!travelWithinLimit(travelOut, !!next?.isAnchor)) continue;

      const available = gapMinutes - travelIn - travelOut;
      if (available < MIN_FLEX_BLOCK_MIN) continue;

      const category = place.category || '';
      const categoryKey = category.toLowerCase();
      const baseDur = plannedDurationMinutes(place, categoryKey, pace);
      let duration = Math.min(baseDur, available);
      if (duration < MIN_FLEX_BLOCK_MIN) continue;

      const startMin = prev.endMin + travelIn;
      const endMin = startMin + duration;
      if (next && endMin + travelOut > next.startMin) continue;
      if (!next && endMin > DAY_END_MIN) continue;

      if (!isWeekend && categoryKey === 'brunch') continue;
      if (isWeekend) {
        if (brunchChosen && categoryKey === 'lunch') continue;
        if (lunchChosen && categoryKey === 'brunch') continue;
      }
      if (categoryKey !== 'breakfast' && categoryKey !== 'coffee' && startMin < GENERAL_ACTIVITY_START_MIN) continue;
      if (categoryKey === 'breakfast') {
        if (startMin < BREAKFAST_EARLIEST_MIN || startMin >= BREAKFAST_LATEST_MIN) continue;
      }
      if (categoryKey === 'brunch') {
        if (startMin < BRUNCH_START_MIN || startMin >= BRUNCH_END_MIN) continue;
      }
      if (startMin < LUNCH_START_MIN && isLunchy(place, category)) continue;
      if (categoryKey === 'lunch') {
        if (startMin < LUNCH_START_MIN || startMin >= LUNCH_WINDOW_END) continue;
      }

      const prevPlace = placeByName.get(normName(prev.title));
      const nextPlace = next ? placeByName.get(normName(next.title)) : undefined;
      const candidateIsMorning = isMorningMealCategory(categoryKey, place);
      if (isMorningMealCategory(prev.category, prevPlace) && candidateIsMorning) continue;
      if (next && isMorningMealCategory(next.category, nextPlace) && candidateIsMorning) continue;

      const candidateIsMeal = isMealCategory(categoryKey, place);
      if (candidateIsMeal && startMin >= AFTERNOON_START_MIN && startMin < AFTERNOON_END_MIN) continue;
      if (categoryKey === 'dinner' && startMin < DINNER_START_MIN) continue;
      if (candidateIsMeal && !['breakfast','brunch','lunch','dinner'].includes(categoryKey) && startMin < DINNER_START_MIN) continue;
      if (isMealCategory(prev.category, prevPlace) && candidateIsMeal) continue;
      if (next && isMealCategory(next.category, nextPlace) && candidateIsMeal) continue;
      if (isBarCategory(categoryKey) && startMin < FIVE_PM_MIN) continue;

      const hoursCategory = (isBarCategory(categoryKey) || isFoodCategory(categoryKey)) ? category : (place.category || category);
      if (isLikelyClosedDuring(place.hours, hoursCategory, startMin, endMin, date) > 0) continue;

      const leftover = gapMinutes - (travelIn + duration + travelOut);
      if (leftover < 0) continue;

      const scheduled: Scheduled = {
        title: place.name,
        location: placeLoc,
        description: place.description ?? 'Worth a stop nearby.',
        category: place.category || 'walk',
        startMin,
        endMin,
        url: place.url,
        travelMinFromPrev: travelIn,
        travelModeFromPrev: recommendedTravelMode(travelIn),
      };

      const score = travelIn * 1.4 + travelOut * 1.2 + leftover * 0.8;
      if (!best || score < best.score) {
        best = { scheduled, place, score };
      }
    }
    return best;
  }

  async function chooseGapActivity(
    prev: Scheduled,
    next: Scheduled | null,
    gapMinutes: number
  ): Promise<{ stop: Scheduled; place?: Place } | null> {
    const attempt = (): { stop: Scheduled; place: Place } | null => {
      const pick = tryGapPool(suggestionStream, prev, next, gapMinutes);
      return pick ? { stop: pick.scheduled, place: pick.place } : null;
    };

    let selection = attempt();
    if (!selection) {
      const hint = prev.location || next?.location || preferredArea || city;
      await ensureExtraCandidates(hint);
      selection = attempt();
    }
    if (!selection) return null;

    const key = normName(selection.place.name);
    usedNameKeys.add(key);
    removeFromSuggestionStream(selection.place);

    return { stop: selection.stop, place: selection.place };
  }

  async function fillGapsWithActivities(): Promise<void> {
    if (!scheduled.length) return;

    const considerStartGap = async () => {
      if (scheduled.length >= maxStops) return;
      const first = scheduled[0];
      if (!first) return;
      const gap = first.startMin - dayStartMin;
      if (gap < MIN_FLEX_BLOCK_MIN) return;
      const virtualPrev: Scheduled = {
        title: 'START_OF_DAY',
        location: first.location || preferredArea || city,
        description: 'Day start',
        category: 'start',
        startMin: dayStartMin,
        endMin: dayStartMin,
        url: undefined,
        travelMinFromPrev: 0,
        travelModeFromPrev: 'walk',
      };
      let fillerSource: Place | null = null;
      let fillerSelection = await chooseGapActivity(virtualPrev, first, gap);
      let filler = fillerSelection?.stop ?? null;
      if (fillerSelection?.place) fillerSource = fillerSelection.place;
      if (!filler && gap >= LARGE_GAP_MIN && scheduled.length < maxStops) {
        const fallbackPlace = takeNearbyNonFoodPlace(first.location || preferredArea || city);
        if (fallbackPlace) {
          const built = buildScheduledStopBetween(virtualPrev, first, fallbackPlace);
          if (built) {
            filler = built;
            fillerSource = fallbackPlace;
          }
        }
      }
      if (!filler && scheduled.length < maxStops) {
        const candidate = makeNonFoodFillerStop(first.location || preferredArea || city, vibes, pace);
        const loc = candidate.location || first.location || preferredArea || city;
        const travelIn = minutesTravel(virtualPrev.location || city, loc);
        if (travelWithinLimit(travelIn, false)) {
          const startMin = virtualPrev.endMin + travelIn;
          const travelOut = minutesTravel(loc, first.location || city);
          if (travelWithinLimit(travelOut, !!first.isAnchor)) {
            const available = first.startMin - travelOut - startMin;
            const duration = Math.min(candidate.duration, available);
            if (duration >= MIN_FLEX_BLOCK_MIN) {
              filler = {
                title: candidate.title,
                location: loc,
                description: candidate.description ?? 'Ease into the day with a light breakfast and stroll.',
                category: candidate.category,
                startMin,
                endMin: startMin + duration,
                url: candidate.url,
                travelMinFromPrev: travelIn,
                travelModeFromPrev: recommendedTravelMode(travelIn),
              };
            }
          }
        }
      }
      if (filler) {
        scheduled.unshift(filler);
        if (fillerSource) {
          removePlaceByName(fillerSource.name);
          registerStop(filler, fillerSource);
        } else {
          registerStop(filler);
        }
        refreshTravelMetadata();
      }
    };

    const considerEndGap = async () => {
      const last = scheduled[scheduled.length - 1];
      if (!last) return;
      const gap = DAY_END_MIN - last.endMin;
      if (gap < MIN_FLEX_BLOCK_MIN) return;
      if (scheduled.length >= maxStops) return;
      const virtualNext: Scheduled = {
        title: 'END_OF_DAY',
        location: last.location || city,
        description: 'Day wrap',
        category: 'wrap',
        startMin: DAY_END_MIN,
        endMin: DAY_END_MIN,
        url: undefined,
        travelMinFromPrev: 0,
        travelModeFromPrev: 'walk',
      };
      let fillerSource: Place | null = null;
      let fillerSelection = await chooseGapActivity(last, virtualNext, gap);
      let filler = fillerSelection?.stop ?? null;
      if (fillerSelection?.place) fillerSource = fillerSelection.place;
      if (!filler && gap >= LARGE_GAP_MIN && scheduled.length < maxStops) {
        const fallbackPlace = takeNearbyNonFoodPlace(last.location || city);
        if (fallbackPlace) {
          const built = buildScheduledStopBetween(last, virtualNext, fallbackPlace);
          if (built) {
            filler = built;
            fillerSource = fallbackPlace;
          }
        }
      }
      if (!filler && scheduled.length < maxStops) {
        const candidate = makeNonFoodFillerStop(last.location || city, vibes, pace);
        const loc = candidate.location || last.location || city;
        const travelIn = minutesTravel(last.location || city, loc);
        if (travelWithinLimit(travelIn, !!last.isAnchor)) {
          const startMin = last.endMin + travelIn;
          const travelOut = minutesTravel(loc, virtualNext.location || city);
          if (travelWithinLimit(travelOut, false)) {
            const available = virtualNext.startMin - travelOut - startMin;
            const duration = Math.min(candidate.duration, available);
            if (duration >= MIN_FLEX_BLOCK_MIN) {
              filler = {
                title: candidate.title,
                location: loc,
                description: candidate.description ?? 'Round out the afternoon with a nearby stop.',
                category: candidate.category,
                startMin,
                endMin: startMin + duration,
                url: candidate.url,
                travelMinFromPrev: travelIn,
                travelModeFromPrev: recommendedTravelMode(travelIn),
              };
            }
          }
        }
      }
      if (filler) {
        scheduled.push(filler);
        if (fillerSource) {
          removePlaceByName(fillerSource.name);
          registerStop(filler, fillerSource);
        } else {
          registerStop(filler);
        }
        refreshTravelMetadata();
      }
    };

    await considerStartGap();

    let iterations = 0;
    let updated = true;
    while (updated && iterations < 6) {
      updated = false;
      iterations += 1;
      for (let i = 0; i < scheduled.length - 1; i++) {
        if (scheduled.length >= maxStops) break;

        const current = scheduled[i];
        const next = scheduled[i + 1];
        const gap = next.startMin - current.endMin;
        if (gap < MIN_FLEX_BLOCK_MIN) continue;
        let fillerSource: Place | null = null;
        let fillerSelection = await chooseGapActivity(current, next, gap);
        let filler = fillerSelection?.stop ?? null;
        if (fillerSelection?.place) fillerSource = fillerSelection.place;
        if (!filler && gap >= LARGE_GAP_MIN && scheduled.length < maxStops) {
          const fallbackPlace = takeNearbyNonFoodPlace(current.location || city);
          if (fallbackPlace) {
            const built = buildScheduledStopBetween(current, next, fallbackPlace);
            if (built) {
              filler = built;
              fillerSource = fallbackPlace;
            }
          }
        }
        if (!filler) continue;
        scheduled.splice(i + 1, 0, filler);
        if (fillerSource) {
          removePlaceByName(fillerSource.name);
          registerStop(filler, fillerSource);
        } else {
          registerStop(filler);
        }
        refreshTravelMetadata();
        updated = true;
      }
    }

    await considerEndGap();
  }

  // Bring in extra places from provider (LLM/static/web)
  try {
    const extra = await fetchExtraPlaces({
      city,
      vibes,
      neighborhoodsHint: preferredArea,
      wantCategories: ['park','walk','view','landmark','museum','gallery','market'],
      excludeNames: Array.from(anchorNameKeys),
      limit: 20,
    });
    if (Array.isArray(extra) && extra.length) {
      const have = new Set(suggestionStream.map(p => normName(p.name)));
      for (const p of extra) {
        const key = normName(p.name);
        if (!have.has(key)) {
          suggestionStream.push({
            name: p.name,
            category: p.category || 'walk',
            neighborhood: p.neighborhood || p.location,
            location: p.location || p.neighborhood,
            duration_min: p.duration_min ?? undefined,
            description: p.description,
            url: p.url,
            vibe_tags: p.vibe_tags,
            energy_tags: p.energy_tags,
            hours: p.hours, // some already enriched
            lat: p.lat,
            lng: p.lng,
          });
          have.add(key);
        }
      }
    }
  } catch {}

  // Category wheel (vibe-reordered)
  let candidateCategories = [
    'breakfast', 'coffee', 'brunch', 'park', 'walk', 'museum', 'gallery',
    'lunch', 'market', 'landmark', 'view', 'shopping',
    'snack', 'show', 'dinner', 'bar', 'drinks',
  ];
  if (vibes?.length) {
    const vset = new Set(vibes.map(v => v.toLowerCase()));
    const head: string[] = [];
    const tail = new Set(candidateCategories);

    if (vset.has('classic')) {
      ['landmark','museum','view','walk','park','show'].forEach(c => {
        if (tail.delete(c)) head.push(c);
      });
    }
    if (vset.has('curator')) {
      ['museum','gallery','show','coffee','brunch','shopping'].forEach(c => {
        if (tail.delete(c)) head.push(c);
      });
    }
    if (vset.has('local')) {
      ['coffee','brunch','market','walk','park','shopping','snack','lunch','bar','dinner'].forEach(c => {
        if (tail.delete(c)) head.push(c);
      });
    }

    candidateCategories = [...head, ...Array.from(tail)];
  }

  // Scheduling state
  const scheduled: Scheduled[] = [];
  const target = targetCount(pace, anchors.length);
  let currentMin = dayStartMin;
  let currentLocation: string = anchors.length ? (anchors[0].location || city) : city;

  const refreshTravelMetadata = () => {
    if (!scheduled.length) return;
    recomputeTravelMetadata(scheduled, city);
  };

  const usedNameKeys = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const cuisineCounts = new Map<string, number>();

  const travelFromTo = (from: string, to: string) => minutesTravel(from || city, to || city);
  const minBlock = 20;

  const wouldExceedCategoryMinutes = wouldExceedCategoryMinutesFactory(scheduled);
  const wouldExceedCategoryCounts  = wouldExceedCategoryCountsFactory(scheduled);
  const neighborhoodLockCounts = new Map<string, number>();
  const activeAreaLock = { area: null as string | null, remaining: 0 };

  function resetAreaLock() {
    activeAreaLock.area = null;
    activeAreaLock.remaining = 0;
  }

  function areaLockInfo(): { area: string; remaining: number } | null {
    return activeAreaLock.area && activeAreaLock.remaining > 0
      ? { area: activeAreaLock.area, remaining: activeAreaLock.remaining }
      : null;
  }

  function advanceAreaLock(areaKey: string | null) {
    if (!areaKey) {
      if (activeAreaLock.remaining <= 0) resetAreaLock();
      return;
    }
    if (activeAreaLock.area && activeAreaLock.remaining > 0) {
      if (areaKey === activeAreaLock.area) {
        activeAreaLock.remaining -= 1;
        if (activeAreaLock.remaining <= 0) resetAreaLock();
      } else {
        activeAreaLock.area = areaKey;
        activeAreaLock.remaining = NEIGHBORHOOD_LOCK_RUN - 1;
      }
    } else {
      activeAreaLock.area = areaKey;
      activeAreaLock.remaining = NEIGHBORHOOD_LOCK_RUN - 1;
    }
  }

  const startAreaCategoryCounts = new Map<string, number>();
  if (preferredArea) {
    const prefLower = preferredArea.toLowerCase();
    for (const place of suggestionStream) {
      const loc = (place.neighborhood || place.location || '').toLowerCase();
      if (!loc.includes(prefLower)) continue;
      const catKey = (place.category || 'misc').toLowerCase();
      startAreaCategoryCounts.set(catKey, 1 + (startAreaCategoryCounts.get(catKey) || 0));
    }
  }

  const scheduledAreaCounts = new Map<string, number>();
  const areaPartnerNeeds = new Map<string, number>();
  const fallbackFetchAttempts = new Set<string>();

  function registerAreaForStop(stop: Scheduled, opts?: { isAnchor?: boolean }) {
    const areaKey = areaKeyFromStop(stop);
    if (!areaKey || areaKey === cityAreaKey) return;
    const prev = scheduledAreaCounts.get(areaKey) || 0;
    scheduledAreaCounts.set(areaKey, prev + 1);

    const isAnchorStop = !!opts?.isAnchor;
    const catKey = (stop.category || '').toLowerCase();
    const isFoodStop = isFoodCategory(catKey);

    const decrementNeed = () => {
      const need = areaPartnerNeeds.get(areaKey);
      if (need) {
        if (need <= 1) areaPartnerNeeds.delete(areaKey);
        else areaPartnerNeeds.set(areaKey, need - 1);
      }
    };

    if (isAnchorStop || anchorAreaKeys.has(areaKey)) {
      decrementNeed();
      return;
    }

    if (prev === 0) {
      if (!isFoodStop) {
        areaPartnerNeeds.set(areaKey, (areaPartnerNeeds.get(areaKey) || 0) + 1);
      }
      return;
    }

    decrementNeed();
  }

  function outstandingAreaKeys(): string[] {
    return Array.from(areaPartnerNeeds.entries())
      .filter(([, need]) => need > 0)
      .map(([area]) => area);
  }

  function titleizeAreaKey(areaKey: string): string {
    return areaKey
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function areaLabelFromKey(areaKey: string | null): string | undefined {
    if (!areaKey) return undefined;
    for (const place of dataset) {
      const key = areaKeyFromPlace(place);
      if (key && key === areaKey) {
        return place.neighborhood || place.location || undefined;
      }
    }
    return titleizeAreaKey(areaKey);
  }

  function gatherExcludeNames(): string[] {
    const names = new Set<string>();
    for (const place of suggestionStream) names.add(place.name);
    for (const stop of scheduled) names.add(stop.title);
    for (const anchor of anchors) names.add(anchor.title);
    for (const lock of locks) {
      if (lock.title) names.add(lock.title);
    }
    return Array.from(names);
  }

  async function ensureFallbackCandidatesFor(
    categories: string[],
    opts: { areaKey?: string | null; locationHint?: string }
  ): Promise<boolean> {
    const normalized = Array.from(
      new Set(
        categories
          .map((c) => (c || '').toLowerCase())
          .filter((c) => !!c)
      )
    );
    if (!normalized.length) return false;

    const areaHintLabel = areaLabelFromKey(opts.areaKey ?? null);
    const locationHint = opts.locationHint?.trim() || '';
    const neighborhoodsHint =
      areaHintLabel ||
      (locationHint ? locationHint : '') ||
      preferredArea ||
      city;

    const attemptKey = `${normalized.slice().sort().join('|')}|${neighborhoodsHint.toLowerCase()}`;
    if (fallbackFetchAttempts.has(attemptKey)) return false;
    fallbackFetchAttempts.add(attemptKey);

    let extra: Awaited<ReturnType<typeof fetchExtraPlaces>> = [];
    try {
      extra = await fetchExtraPlaces({
        city,
        vibes,
        neighborhoodsHint,
        wantCategories: normalized,
        excludeNames: gatherExcludeNames(),
        limit: Math.max(4, normalized.length * 2),
      });
    } catch {
      extra = [];
    }
    if (!Array.isArray(extra) || !extra.length) return false;

    const newPlaces: Place[] = [];
    const existingKeys = new Set(suggestionStream.map((p) => normName(p.name)));
    for (const raw of extra) {
      const key = normName(raw.name);
      if (existingKeys.has(key)) continue;
      const converted = providerToPlace(raw);
      suggestionStream.push(converted);
      existingKeys.add(key);
      newPlaces.push(converted);
    }
    if (!newPlaces.length) return false;

    const enrichHint = areaHintLabel || preferredArea;
    await enrichMissingHoursFor(newPlaces, city, enrichHint);
    suggestionStream = dedupePlaces(suggestionStream);

    for (const place of newPlaces) {
      const areaKey = areaKeyFromPlace(place);
      if (areaKey && areaKey !== cityAreaKey) {
        areaAvailability.set(areaKey, 1 + (areaAvailability.get(areaKey) || 0));
      }
      if (preferredArea) {
        const prefLower = preferredArea.toLowerCase();
        const loc = (place.neighborhood || place.location || '').toLowerCase();
        if (loc.includes(prefLower)) {
          const catKey = (place.category || 'misc').toLowerCase();
          startAreaCategoryCounts.set(catKey, 1 + (startAreaCategoryCounts.get(catKey) || 0));
        }
      }
    }

    return true;
  }

  type LunchGap = {
    index: number;
    prev: Scheduled | null;
    next: Scheduled | null;
    slotStart: number;
    slotEnd: number;
  };
type LunchInsertion = {
  entry: Scheduled;
  nameKey: string;
  place?: Place;
};
type Gap = {
  index: number;
  startMin: number;
  endMin: number;
  location?: string;
  size: number;
};

  function ensureLunchStop() {
    if (skipLunch) return;
    if (isWeekend && brunchChosen) return;
    if (hasLunchInWindow()) return;
    let gap = findLunchGap();

    if (!gap) {
      const idx = scheduled.findIndex(s => !s.isAnchor && overlapsWindow(s.startMin, s.endMin, LUNCH_START_MIN, LUNCH_WINDOW_END));
      if (idx >= 0) {
        const slot = scheduled[idx];
        const latestEnd = Math.min(slot.endMin, LUNCH_WINDOW_END);
        const lunchStart = Math.max(slot.startMin, LUNCH_START_MIN);
        let lunchEnd = lunchStart + MIN_LUNCH_DURATION;
        if (lunchEnd > latestEnd) lunchEnd = latestEnd;
        if (lunchEnd - lunchStart >= MIN_LUNCH_DURATION) {
          const beforeDuration = lunchStart - slot.startMin;
          const afterDuration = slot.endMin - lunchEnd;
          const baseLoc = slot.location || slot.title || city;
          const lunchPlace = pickLunchCandidate(baseLoc) || pickLunchCandidate(city);
          if (!lunchPlace) return;
          const lunchLoc = lunchPlace.location || lunchPlace.neighborhood || baseLoc;
          const replacement: Scheduled = {
            title: lunchPlace.name,
            location: lunchLoc,
            description: lunchPlace.description ?? 'Take a proper lunch break before the afternoon plans.',
            category: lunchPlace.category || 'lunch',
            startMin: lunchStart,
            endMin: lunchEnd,
            url: ensureGoogleMapsUrl(lunchPlace.url, lunchLoc, lunchPlace.name),
          };
          const inserts: Scheduled[] = [];
          if (beforeDuration >= minBlock) {
            inserts.push({
              ...slot,
              endMin: lunchStart,
            });
          }
          inserts.push(replacement);
          if (afterDuration >= minBlock) {
            inserts.push({
              ...slot,
              startMin: lunchEnd,
            });
          }
          scheduled.splice(idx, 1, ...inserts);
          rebuildTrackingState();
          refreshTravelMetadata();
        }
      }
      if (hasLunchInWindow()) return;
      gap = findLunchGap();
      if (!gap) return;
    }

    const picked = pickLunchForGap(gap) ?? buildFallbackLunch(gap);
    if (!picked) return;

    scheduled.splice(gap.index, 0, picked.entry);
    registerStop(picked.entry, picked.place);
    if (picked.place && preferredArea) {
      const prefLower = preferredArea.toLowerCase();
      const locLower = (picked.entry.location || '').toLowerCase();
      if (locLower.includes(prefLower)) {
        startAreaCategoryCounts.set('lunch', 1 + (startAreaCategoryCounts.get('lunch') || 0));
      }
    }
    refreshTravelMetadata();
  }

  function hasLunchInWindow(): boolean {
    return scheduled.some((s) => {
      const cat = (s.category || '').toLowerCase();
      if (cat === 'lunch') {
        return overlapsWindow(s.startMin, s.endMin, LUNCH_START_MIN, LUNCH_WINDOW_END);
      }
      if (isWeekend && cat === 'brunch') {
        return overlapsWindow(s.startMin, s.endMin, BRUNCH_START_MIN, BRUNCH_END_MIN);
      }
      return false;
    });
  }

  function findLunchGap(): LunchGap | null {
    if (wouldExceedCategoryCounts('lunch', vibes)) return null;
    let prev: Scheduled | null = null;
    for (let i = 0; i <= scheduled.length; i++) {
      const next = i < scheduled.length ? scheduled[i] : null;
      const gapStart = prev ? prev.endMin : dayStartMin;
      const gapEnd = next ? next.startMin : DAY_END_MIN;
      const slotStart = Math.max(gapStart, LUNCH_START_MIN);
      const slotEnd = Math.min(gapEnd, LUNCH_WINDOW_END);
      if (slotEnd - slotStart >= MIN_LUNCH_DURATION) {
        return { index: i, prev, next, slotStart, slotEnd };
      }
      prev = next;
    }
    return null;
  }

  function minutesUntilLunchWindowEnd(currentMin: number) {
    return LUNCH_WINDOW_END - currentMin;
  }

  function shouldPrioritizeLunchNow(currentMin: number, timeLeft: number): boolean {
    if (skipLunch) return false;
    if (hasLunchInWindow()) return false;
    if (currentMin >= LUNCH_WINDOW_END) return false;
    if (currentMin >= LUNCH_START_MIN - 30) return true;
    const windowMinutesLeft = minutesUntilLunchWindowEnd(currentMin);
    if (windowMinutesLeft <= MIN_LUNCH_DURATION) return true;
    if (timeLeft < MIN_LUNCH_DURATION) return false;
    return windowMinutesLeft <= MIN_LUNCH_DURATION + 45;
  }

  function pruneSoloNeighborhoodStops() {
    const minStops = Math.max(PACE_ACTIVITY_RANGE[pace].min, anchors.length);
    if (scheduled.length <= minStops) return;
    const leftovers = outstandingAreaKeys();
    if (!leftovers.length) return;
    for (const area of leftovers) {
      for (let i = scheduled.length - 1; i >= 0; i--) {
        const stop = scheduled[i];
        if (stop.isAnchor) continue;
        if (areaKeyFromStop(stop) === area) {
          scheduled.splice(i, 1);
          if (scheduled.length <= minStops) break;
        }
      }
    }
    areaPartnerNeeds.clear();
  }

  function pickLunchForGap(gap: LunchGap): LunchInsertion | null {
    if (isWeekend && brunchChosen) return null;
    const prev = gap.prev;
    const next = gap.next;
    const departLocation = prev?.location || city;
    const departTime = prev ? prev.endMin : Math.max(dayStartMin, LUNCH_START_MIN);
    const nextLocation = next?.location || city;

    let bestScore = Infinity;
    let best: { place: Place; start: number; duration: number; travel: number } | null = null;

    for (const place of suggestionStream) {
      const category = (place.category || '').toLowerCase();
      if (category !== 'lunch') continue;
      const nameKey = normName(place.name);
      if (usedNameKeys.has(nameKey)) continue;

      const location = place.location || place.neighborhood || city;
      const travelIn = travelFromTo(departLocation, location);
      if (!travelWithinLimit(travelIn, false)) continue;
      const earliestStart = Math.max(gap.slotStart, departTime + travelIn);
      const maxAllowed = gap.slotEnd - earliestStart;
      if (maxAllowed < MIN_LUNCH_DURATION) continue;

      const baseDur = plannedDurationMinutes(place, 'lunch', pace);
      let duration = Math.max(baseDur, MIN_LUNCH_DURATION);
      duration = Math.min(duration, maxAllowed);
      if (duration < MIN_LUNCH_DURATION) continue;
      if (wouldExceedCategoryMinutes('lunch', duration)) continue;

      const end = earliestStart + duration;
      if (next) {
        const travelOut = travelFromTo(location, nextLocation);
        if (!travelWithinLimit(travelOut, !!next.isAnchor)) continue;
        if (end + travelOut > next.startMin) continue;
      }

      let score = scorePlace(place, 'lunch');
      score += startAreaPenalty(place, preferredArea, departLocation, gap.index, {
        category: 'lunch',
        startAreaAvailability: startAreaCategoryCounts,
      });
      score += repetitionPenalty(place, categoryCounts, usedNameKeys);
      score += cuisineRepeatPenalty(place, cuisineCounts, vibes);
      score += datasetFoodBiasPenalty(suggestionStream, vibes, 'lunch');
      score += travelIn / 60 * 0.5;
      if (next) {
        const travelOut = travelFromTo(location, nextLocation);
        score += travelOut / 60 * 0.4;
      }

      if (score < bestScore) {
        bestScore = score;
        best = { place, start: earliestStart, duration, travel: travelIn };
      }
    }

    if (!best) return null;
    const entry: Scheduled = {
      title: best.place.name,
      location: best.place.location || best.place.neighborhood || city,
      description: best.place.description ?? 'Lunch break.',
      category: 'lunch',
      startMin: best.start,
      endMin: best.start + best.duration,
      url: best.place.url,
      lat: best.place.lat,
      lng: best.place.lng,
    };
    entry.travelMinFromPrev = best.travel;
    entry.travelModeFromPrev = recommendedTravelMode(best.travel);
    return { entry, nameKey: normName(best.place.name), place: best.place };
  }

  function buildFallbackLunch(gap: LunchGap): LunchInsertion | null {
    if (isWeekend && brunchChosen) return null;
    const prev = gap.prev;
    const next = gap.next;
    const baseDepartTime = prev ? prev.endMin : Math.max(dayStartMin, LUNCH_START_MIN);
    let duration = Math.max(minFor('lunch', pace), MIN_LUNCH_DURATION);
    const baseLoc = prev?.location || next?.location || preferredArea || city;
    const fromLocation = prev?.location || city;
    const travelFromPrev = travelFromTo(fromLocation || city, baseLoc || city);
    if (!travelWithinLimit(travelFromPrev, false)) return null;
    const start = Math.max(gap.slotStart, baseDepartTime + travelFromPrev);
    const maxAllowed = gap.slotEnd - start;
    if (maxAllowed < MIN_LUNCH_DURATION) return null;
    duration = Math.min(duration, maxAllowed);
    if (duration < MIN_LUNCH_DURATION) return null;
    if (wouldExceedCategoryMinutes('lunch', duration)) return null;

    if (next) {
      const travelOut = travelFromTo(baseLoc, next.location || city);
      if (!travelWithinLimit(travelOut, !!next.isAnchor)) return null;
      if (start + duration + travelOut > next.startMin) return null;
    }

    const lunchPlace = pickLunchCandidate(baseLoc) || pickLunchCandidate(city);
    if (!lunchPlace) return null;
    const lunchLoc = lunchPlace.location || lunchPlace.neighborhood || baseLoc;

    const entry: Scheduled = {
      title: lunchPlace.name,
      location: lunchLoc,
      description: lunchPlace.description ?? 'Take a proper lunch break before the afternoon plans.',
      category: lunchPlace.category || 'lunch',
      startMin: start,
      endMin: start + duration,
      url: ensureGoogleMapsUrl(lunchPlace.url, lunchLoc, lunchPlace.name),
      lat: lunchPlace.lat,
      lng: lunchPlace.lng,
    };
    entry.travelMinFromPrev = travelFromPrev;
    entry.travelModeFromPrev = recommendedTravelMode(travelFromPrev);
    return { entry, nameKey: normName(lunchPlace.name), place: lunchPlace };
  }

  function findLargestGap(boundsStart: number, boundsEnd: number): Gap | null {
    const sorted = [...scheduled].sort((a, b) => a.startMin - b.startMin);
    let prevEnd = boundsStart;
    let prevLocation: string | undefined = city;
    let best: Gap | null = null;

    for (let i = 0; i <= sorted.length; i++) {
      const next = sorted[i];
      let gapStart = Math.max(prevEnd, boundsStart);
      let gapEnd = Math.min(next ? next.startMin : boundsEnd, boundsEnd);

      if (gapEnd - gapStart >= minBlock) {
        const size = gapEnd - gapStart;
        if (!best || size > best.size) {
          best = { index: i, startMin: gapStart, endMin: gapEnd, location: prevLocation, size };
        }
      }

      if (next) {
        prevEnd = Math.max(next.endMin, boundsStart);
        prevLocation = next.location || prevLocation;
        if (prevEnd >= boundsEnd) break;
      }
    }
    return best;
  }

  function insertFillerStop(gap: Gap): boolean {
    if (scheduled.length >= maxStops) return false;
    const window = gap.endMin - gap.startMin;
    if (window < minBlock) return false;
    const baseLoc = gap.location || city;
    const lastStopForFiller = gap.index > 0 ? scheduled[gap.index - 1] : undefined;
    const filler = buildFillerCandidate(baseLoc, false, lastStopForFiller);
    if (!filler) return false;
    let duration = filler.duration * durationMultiplierFor(pace, filler.category);
    duration = Math.min(window, Math.max(minBlock, duration));
    if (duration < minBlock) return false;
    if (filler.sourcePlaceName) removePlaceByName(filler.sourcePlaceName);

    const loc = filler.location ?? baseLoc;
    const stop: Scheduled = {
      title: filler.title,
      location: loc,
      description: filler.description ?? 'Take a moment here.',
      category: filler.category,
      startMin: gap.startMin,
      endMin: gap.startMin + duration,
      url: ensureGoogleMapsUrl(filler.url, loc || city, filler.title),
      travelMinFromPrev: 0,
      travelModeFromPrev: 'walk',
      lat: filler.lat,
      lng: filler.lng,
    };
    scheduled.splice(gap.index, 0, stop);
    registerStop(stop);
    refreshTravelMetadata();
    return true;
  }

  function ensureMinimumStops() {
    const minStops = Math.max(PACE_ACTIVITY_RANGE[pace].min, anchors.length);
    if (scheduled.length >= maxStops) return;
    let guard = 12;
    while (scheduled.length < minStops && scheduled.length < maxStops && guard-- > 0) {
    const gap = findLargestGap(dayStartMin, DAY_END_MIN);
      if (!gap) break;
      if (!insertFillerStop(gap)) break;
    }
  }

  function ensureNineToFiveCoverage() {
    scheduled.sort((a, b) => a.startMin - b.startMin);
    if (!scheduled.length) return;
    if (scheduled[0].startMin > dayStartMin) {
      if (scheduled.length >= maxStops) return;
      const gap: Gap = {
        index: 0,
        startMin: dayStartMin,
        endMin: scheduled[0].startMin,
        location: city,
        size: scheduled[0].startMin - dayStartMin,
      };
      insertFillerStop(gap);
    }
    scheduled.sort((a, b) => a.startMin - b.startMin);
    const last = scheduled[scheduled.length - 1];
    if (last && last.endMin < FIVE_PM_MIN) {
      if (scheduled.length >= maxStops) return;
      const endMin = Math.min(DAY_END_MIN, Math.max(FIVE_PM_MIN, last.endMin + minBlock));
      if (endMin - last.endMin >= minBlock) {
        const gap: Gap = {
          index: scheduled.length,
          startMin: last.endMin,
          endMin,
          location: last.location || city,
          size: endMin - last.endMin,
        };
        insertFillerStop(gap);
      }
    }
  }

  function rebuildTrackingState() {
    categoryCounts.clear();
    cuisineCounts.clear();
    usedNameKeys.clear();
    scheduledAreaCounts.clear();
    areaPartnerNeeds.clear();
    neighborhoodLockCounts.clear();
    resetAreaLock();
    brunchChosen = false;
    lunchChosen = false;
    for (const s of scheduled) {
      registerStop(s);
    }
    refreshTravelMetadata();
  }

  function recentAreaRunLength(areaKey: string | null): number {
    if (!areaKey) return 0;
    let count = 0;
    for (let i = scheduled.length - 1; i >= 0; i--) {
      const a = areaKeyFromStop(scheduled[i]);
      if (a && a === areaKey) count += 1;
      else break;
    }
    return count;
  }

  function areaVisitPenalty(areaKey: string | null): number {
    if (!areaKey) return 0;
    const visits = scheduledAreaCounts.get(areaKey) || 0;
    const run = recentAreaRunLength(areaKey);
    let penalty = 0;
    if (visits >= MAX_AREA_VISITS) penalty += 15 * (visits - MAX_AREA_VISITS + 1);
    if (run >= MAX_AREA_RUN) penalty += 12 * (run - MAX_AREA_RUN + 1);
    return penalty;
  }

  function previousDistinctArea(currentArea: string | null): string | null {
    for (let i = scheduled.length - 1; i >= 0; i--) {
      const area = areaKeyFromStop(scheduled[i]);
      if (!area) continue;
      if (currentArea && area === currentArea) continue;
      return area;
    }
    return null;
  }

  function extractQueryFromUrl(url?: string): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const query = parsed.searchParams.get('query') || parsed.searchParams.get('destination');
      if (query) return query;
      if (parsed.hostname.endsWith('google.com') && parsed.pathname.includes('/maps/place/')) {
        const segments = parsed.pathname.split('/').filter(Boolean);
        if (segments.length >= 2) {
          return decodeURIComponent(segments[2] || segments[1]);
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  function locationQueryForStop(stop: Scheduled): string {
    if (typeof stop.lat !== 'number' || typeof stop.lng !== 'number') {
      const datasetPlace = placeByName.get(normName(stop.title));
      if (datasetPlace) {
        if (stop.lat == null && typeof datasetPlace.lat === 'number') stop.lat = datasetPlace.lat;
        if (stop.lng == null && typeof datasetPlace.lng === 'number') stop.lng = datasetPlace.lng;
      }
    }
    if (typeof stop.lat === 'number' && typeof stop.lng === 'number') {
      return `${stop.lat},${stop.lng}`;
    }
    const urlQuery = extractQueryFromUrl(stop.url);
    if (urlQuery) return `${urlQuery}, New York, NY`;
    const parts: string[] = [];
    if (stop.title) parts.push(stop.title);
    if (stop.location) {
      const titleLower = (stop.title || '').toLowerCase();
      const locLower = stop.location.toLowerCase();
      if (!locLower.includes(titleLower)) {
        parts.push(stop.location);
      }
    }
    parts.push(city);
    return parts.filter(Boolean).join(', ');
  }

  async function applyAccurateTravelTimes(list: Scheduled[]) {
    if (list.length < 2) return;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      const origin = locationQueryForStop(prev);
      const destination = locationQueryForStop(curr);
      const accurate = await accurateTravelMinutesBetween(origin, destination, { date });
      if (!accurate) continue;
      const gap = Math.max(0, curr.startMin - prev.endMin);
      if (accurate.minutes > gap) {
        const shift = accurate.minutes - gap;
        curr.startMin += shift;
        curr.endMin += shift;
      }
      curr.travelMinFromPrev = accurate.minutes;
      curr.travelModeFromPrev = accurate.mode;
    }
    list.sort((a, b) => a.startMin - b.startMin);
  }

  function ensureMorningKickoff() {
    scheduled.sort((a, b) => a.startMin - b.startMin);
    const first = scheduled[0];
    const isBreakfastCategory = (cat?: string | null) => {
      if (!cat) return false;
      const key = cat.toLowerCase();
      return key === 'breakfast' || key === 'coffee';
    };

    if (first && isBreakfastCategory(first.category)) {
      if (first.startMin > dayStartMin) {
        const duration = Math.max(first.endMin - first.startMin, CATEGORY_DURATION_OVERRIDE[first.category!.toLowerCase()] ?? 45);
        first.startMin = dayStartMin;
        first.endMin = dayStartMin + duration;
        first.travelMinFromPrev = 0;
        first.travelModeFromPrev = 'walk';
      }
      return;
    }

    if (!first || first.startMin > dayStartMin || !isBreakfastCategory(first?.category)) {
      const baseLoc = first?.location || preferredArea || city;
      const coffee = pickCoffeeCandidate(baseLoc);
      const duration = coffee?.duration ?? 60;
      const endMin = first ? Math.min(first.startMin, dayStartMin + duration) : dayStartMin + duration;
      const stop: Scheduled = coffee
        ? {
            title: coffee.title,
            location: coffee.location ?? baseLoc,
            description: coffee.description ?? 'Ease into the day with a light breakfast near your start point.',
            category: coffee.category,
            startMin: dayStartMin,
            endMin,
            url: ensureGoogleMapsUrl(coffee.url, coffee.location ?? baseLoc, coffee.title),
            travelMinFromPrev: 0,
            travelModeFromPrev: 'walk',
            lat: coffee.lat,
            lng: coffee.lng,
          }
        : {
            title: 'Morning coffee & pastry',
            location: baseLoc,
            description: 'Ease into the day with a light breakfast near your start point.',
            category: 'breakfast',
            startMin: dayStartMin,
            endMin,
            url: ensureGoogleMapsUrl(undefined, baseLoc, 'coffee shop'),
            travelMinFromPrev: 0,
            travelModeFromPrev: 'walk',
          };
      scheduled.unshift(stop);
      registerStop(stop);
      refreshTravelMetadata();
    }
  }

  function ensureDinnerStop() {
    if (hasDinnerAnchor) return;
    if (scheduled.some(s => (s.category || '').toLowerCase() === 'dinner')) return;
    if (!dinnerPlaces.length) return;
    scheduled.sort((a, b) => a.startMin - b.startMin);
    const last = scheduled[scheduled.length - 1] || null;
    const baseLoc = last?.location || last?.title || preferredArea || city;
    const dinnerPlace = pickDinnerCandidate(baseLoc) || pickDinnerCandidate(city);
    if (!dinnerPlace) return;
    const dinnerLoc = dinnerPlace.location || dinnerPlace.neighborhood || baseLoc;
    const travelFromPrev = last ? travelFromTo(last.location || city, dinnerLoc) : 0;
    if (!travelWithinLimit(travelFromPrev, false)) return;
    const earliestDinner = DINNER_START_MIN;
    let startMin = Math.max(earliestDinner, last ? last.endMin + travelFromPrev : earliestDinner);
    if (startMin >= DAY_END_MIN - minBlock) return;
    const duration = plannedDurationMinutes(dinnerPlace, 'dinner', pace);
    let endMin = Math.min(startMin + duration, DAY_END_MIN);
    if (endMin - startMin < minBlock) {
      startMin = Math.max(DAY_END_MIN - minBlock, startMin);
      endMin = Math.min(startMin + duration, DAY_END_MIN);
      if (endMin - startMin < minBlock) return;
    }
    const areaKey = areaKeyFromString(dinnerLoc);
    if (areaKey && !anchorAreaKeys.has(areaKey)) {
      const visits = scheduledAreaCounts.get(areaKey) || 0;
      if (visits >= MAX_AREA_VISITS) return;
      const prevDistinct = previousDistinctArea(areaKeyFromStop(last || { location: preferredArea || city } as Scheduled));
      if (prevDistinct && prevDistinct === areaKey) return;
    }
    const entry: Scheduled = {
      title: dinnerPlace.name,
      location: dinnerLoc,
      description: dinnerPlace.description ?? 'Dinner reservation.',
      category: dinnerPlace.category || 'dinner',
      startMin,
      endMin,
      url: ensureGoogleMapsUrl(dinnerPlace.url, dinnerLoc, dinnerPlace.name),
      travelMinFromPrev: travelFromPrev,
      travelModeFromPrev: recommendedTravelMode(travelFromPrev),
      lat: dinnerPlace.lat,
      lng: dinnerPlace.lng,
    };
    scheduled.push(entry);
    registerStop(entry, dinnerPlace);
    refreshTravelMetadata();
  }

  function ensureMealExpectations() {
    scheduled.sort((a, b) => a.startMin - b.startMin);
    const categories = scheduled.map(s => (s.category || '').toLowerCase());
    const hasBreakfast = categories.some(c => c === 'breakfast' || c === 'coffee');
    const hasLunch = categories.includes('lunch');
    const hasDinner = categories.includes('dinner');
    const hasBrunch = categories.includes('brunch');

    if (isWeekend) {
      if (hasBrunch) {
        if (!hasDinner) {
          ensureDinnerStop();
        }
      } else {
        if (!hasBreakfast) {
          ensureMorningKickoff();
        }
        scheduled.sort((a, b) => a.startMin - b.startMin);
        if (!hasLunch) {
          ensureLunchStop();
        }
        scheduled.sort((a, b) => a.startMin - b.startMin);
        if (!hasDinner) {
          ensureDinnerStop();
        }
      }
    } else {
      if (!hasBreakfast) {
        ensureMorningKickoff();
      }
      scheduled.sort((a, b) => a.startMin - b.startMin);
      if (!hasLunch) {
        ensureLunchStop();
      }
      scheduled.sort((a, b) => a.startMin - b.startMin);
      if (!hasDinner) {
        ensureDinnerStop();
      }
    }
  }

  // Fill up to a limit (hard-skip closed)
  async function fillUntil(limitMin: number) {
    while (scheduled.length < target && currentMin + minBlock <= Math.min(limitMin, DAY_END_MIN)) {
      const timeLeft = Math.min(limitMin, DAY_END_MIN) - currentMin;
      if (timeLeft < minBlock) break;

      const wheel = candidateCategories.filter(c => !wouldExceedCategoryCounts(c, vibes));
      const prioritizeLunchNow = shouldPrioritizeLunchNow(currentMin, timeLeft);
      const outstandingAreasNow = outstandingAreaKeys();
      const currentAreaKey = areaKeyFromString(currentLocation);
      const prevStop = scheduled[scheduled.length - 1] || null;
      const prevStopCategory = prevStop ? (prevStop.category || '').toLowerCase() : undefined;
      const prevPlace = prevStop ? placeByName.get(normName(prevStop.title)) : undefined;
      const previousIsMeal = prevStop ? isMealCategory(prevStopCategory, prevPlace) : false;
      const previousIsMorningMeal = prevStop ? isMorningMealCategory(prevStopCategory, prevPlace) : false;
      const categoryOrder = (() => {
        const base = wheel.length ? wheel : candidateCategories;
        if (!prioritizeLunchNow) return base;
        if (!base.includes('lunch')) return base;
        return ['lunch', ...base.filter(c => c !== 'lunch')];
      })();

      const areaLockState = areaLockInfo();

      let filteredCategories = [...categoryOrder];
      if (currentMin < BREAKFAST_LATEST_MIN) {
        const preferred = filteredCategories.filter(c => {
          const key = c.toLowerCase();
          return key === 'breakfast' || key === 'coffee';
        });
        const others = filteredCategories.filter(c => !preferred.includes(c));
        filteredCategories = preferred.length ? [...preferred, ...others] : filteredCategories;
      }
      if (!isWeekend) {
        filteredCategories = filteredCategories.filter(c => c.toLowerCase() !== 'brunch');
      } else {
        if (brunchChosen) {
          filteredCategories = filteredCategories.filter(c => c.toLowerCase() !== 'lunch');
        }
        if (lunchChosen) {
          filteredCategories = filteredCategories.filter(c => c.toLowerCase() !== 'brunch');
        }
      }

      const pickCandidate = () =>
        pickNextSuggestion(
          filteredCategories,
          suggestionStream,
          city,
          pace,
          wouldExceedCategoryMinutes,
          (p, cat) => {
            let sc = scorePlace(p, cat);
            sc += startAreaPenalty(p, preferredArea, currentLocation, scheduled.length, {
              category: cat,
              startAreaAvailability: startAreaCategoryCounts,
            });
            sc += repetitionPenalty(p, categoryCounts, usedNameKeys);
            sc += dumboStartPenalty(p, scheduled.length, vibes);
            sc += localVibeBoost(vibes, cat);
            sc += vibeCategoryBias(vibes, cat);
            sc += cuisineRepeatPenalty(p, cuisineCounts, vibes);
            sc += datasetFoodBiasPenalty(suggestionStream, vibes, cat);
            const desiredLower = (cat || '').toLowerCase();
            const lastStop = scheduled.length ? scheduled[scheduled.length - 1] : null;
            const lastWasFood = lastStop ? isFoodCategory(lastStop.category) : false;
            if (desiredLower === 'coffee') {
              const priorCoffee = categoryCounts.get('coffee') || 0;
              const priorBreakfast = categoryCounts.get('breakfast') || 0;
              if (priorCoffee + priorBreakfast >= 1) sc += 4.0;
            }
            if (lastWasFood && !isFoodCategory(desiredLower)) {
              sc -= 1.2;
            } else if (!lastWasFood && isFoodCategory(desiredLower) && currentMin >= AFTERNOON_START_MIN && currentMin < DINNER_START_MIN) {
              sc += 0.8;
            }
            const travelMin = travelFromTo(currentLocation || city, p.location || p.neighborhood || city);
            let travelWeight = TRAVEL_WEIGHT;
            if (currentMin < AFTERNOON_START_MIN) travelWeight *= 1.8;
            else if (currentMin < DINNER_START_MIN) travelWeight *= 1.3;
            sc += travelMin * travelWeight;
            const areaKey = areaKeyFromPlace(p);
            const lastArea = lastStop ? areaKeyFromStop(lastStop) : null;
            if (areaKey && lastArea && areaKey !== lastArea) {
              sc += currentMin < DINNER_START_MIN ? 1.8 : 0.6;
            }
            if (areaKey && currentAreaKey && areaKey !== currentAreaKey) {
              sc += currentMin < AFTERNOON_END_MIN ? 2.0 : 0.75;
            }
            if (areaKey && (scheduledAreaCounts.get(areaKey) || 0) === 0 && !anchorAreaKeys.has(areaKey)) {
              const supply = areaAvailability.get(areaKey) || 0;
              sc += supply <= 1 ? 5.0 : 1.4;
            }
            if (areaKey) {
              const recentAreas: string[] = [];
              for (let i = scheduled.length - 1; i >= 0 && recentAreas.length < 3; i--) {
                const area = areaKeyFromStop(scheduled[i]);
                if (area && !recentAreas.includes(area)) recentAreas.push(area);
              }
              if (recentAreas.length && !recentAreas.includes(areaKey)) {
                sc += currentMin < DINNER_START_MIN ? 2.4 : 0.8;
              } else if (recentAreas.includes(areaKey)) {
                sc -= 0.5;
              }
              const prevDistinct = previousDistinctArea(currentAreaKey);
              if (prevDistinct && prevDistinct === areaKey) {
                sc += AREA_BOUNCE_PENALTY;
              }
            }
            if (areaKey && scheduled.length >= 2) {
              const visits = scheduledAreaCounts.get(areaKey) || 0;
              if (visits >= 3) {
                sc += (visits - 2) * 1.8;
              } else if (visits >= 2) {
                sc += 0.9;
              }
              const run = recentAreaRunLength(areaKey);
              if (run >= 2) {
                sc += 2.8 * run;
              }
              let maxVisits = 0;
              for (const value of scheduledAreaCounts.values()) {
                if (value > maxVisits) maxVisits = value;
              }
              if (maxVisits >= 2 && visits >= maxVisits) {
                sc += visits * 2.1;
              }
              if (!anchorAreaKeys.has(areaKey) && visits >= MAX_AREA_VISITS) {
                sc += 40;
              }
              sc += areaVisitPenalty(areaKey);
            }
            if (outstandingAreasNow.length) {
              if (areaKey && outstandingAreasNow.includes(areaKey)) {
                sc -= 1.9;
              } else {
                const lunchRelaxed = (!skipLunch && cat.toLowerCase() === 'lunch');
                sc += lunchRelaxed ? 1.7 : 4.4;
                sc += outstandingAreasNow.length * 0.25;
              }
            }
            if (!skipLunch && cat.toLowerCase() === 'lunch') {
              sc -= prioritizeLunchNow ? 3.2 : 0.6;
            } else if (prioritizeLunchNow) {
              sc += 1.1;
            }
            if (wouldExceedCategoryCounts(cat, vibes)) sc += 99; // safety
            return sc;
          },
        {
          currentMin,
          currentLocation,
          dateISO: date,
          travelFromTo,
          previousCategory: prevStopCategory,
          previousIsMeal,
          previousIsMorningMeal,
          previousStop: prevStop,
          isWeekend,
          brunchChosen,
          lunchChosen,
          areaLock: areaLockState || undefined,
          scheduled
        }
      );

      let chosen = pickCandidate();

      if (!chosen) {
        const fallbackFetched = await ensureFallbackCandidatesFor(filteredCategories, {
          areaKey: areaLockState?.area ?? areaKeyFromString(currentLocation),
          locationHint: (prevStop?.location || currentLocation || preferredArea || city),
        });
        if (fallbackFetched) {
          chosen = pickCandidate();
        }
      }

      // If nothing suitable, try a filler (non-food if cap hit)
      if (!chosen) {
        if (areaLockState) {
          resetAreaLock();
          continue;
        }
        const avoidFoodNow = dayFoodCount(scheduled) >= DAILY_FOOD_CAP;
        const filler = buildFillerCandidate(currentLocation || city, avoidFoodNow, scheduled[scheduled.length - 1]);
        if (filler) {
          const fillerDuration = Math.round(filler.duration * durationMultiplierFor(pace, filler.category));
          const fdur = Math.min(fillerDuration, timeLeft);
          if (fdur >= minBlock) {
            if (filler.sourcePlaceName) removePlaceByName(filler.sourcePlaceName);
            const loc = filler.location ?? currentLocation;
            const s: Scheduled = {
              title: filler.title,
              location: loc,
              description: filler.description ?? 'Explore the area.',
              category: filler.category,
              startMin: currentMin,
              endMin: currentMin + fdur,
              url: ensureGoogleMapsUrl(filler.url, loc || city, filler.title),
              lat: filler.lat,
              lng: filler.lng,
            };
            s.travelMinFromPrev = 0;
            s.travelModeFromPrev = 'walk';
            scheduled.push(s);
            registerStop(s);
            currentLocation = s.location || currentLocation;
            currentMin += fdur;
            refreshTravelMetadata();
            continue;
          }
        }
        break;
      }

      const place = chosen.place;
      const cat   = chosen.category;
      const desiredCat = (cat || '').toLowerCase();
      const baseDur = plannedDurationMinutes(place, desiredCat, pace);
      const dur   = Math.max(MIN_FLEX_BLOCK_MIN, Math.min(baseDur, timeLeft));

      const travel = travelFromTo(currentLocation || city, place.location || place.neighborhood || city);
      const start  = currentMin + travel;
      const end    = start + dur;

      if (wouldExceedCategoryCounts(cat, vibes)) {
        const avoidFoodNow = dayFoodCount(scheduled) >= DAILY_FOOD_CAP;
        const filler = buildFillerCandidate(currentLocation || city, avoidFoodNow, scheduled[scheduled.length - 1]);
        if (filler) {
          const fillerDuration = Math.round(filler.duration * durationMultiplierFor(pace, filler.category));
          const fdur = Math.min(fillerDuration, timeLeft);
          if (fdur >= minBlock) {
            if (filler.sourcePlaceName) removePlaceByName(filler.sourcePlaceName);
            const loc = filler.location ?? currentLocation;
            const sFill: Scheduled = {
              title: filler.title,
              location: loc,
              description: filler.description ?? 'Stretch your legs here.',
              category: filler.category,
              startMin: currentMin,
              endMin: currentMin + fdur,
              url: ensureGoogleMapsUrl(filler.url, loc || city, filler.title),
              lat: filler.lat,
              lng: filler.lng,
            };
            sFill.travelMinFromPrev = 0;
            sFill.travelModeFromPrev = 'walk';
            scheduled.push(sFill);
            registerStop(sFill);
            currentLocation = sFill.location || currentLocation;
            currentMin += fdur;
            refreshTravelMetadata();
            continue;
          }
        }
        break;
      }

      if (end > Math.min(limitMin, DAY_END_MIN)) {
        const avoidFoodNow = dayFoodCount(scheduled) >= DAILY_FOOD_CAP;
        const filler = buildFillerCandidate(currentLocation || city, avoidFoodNow, scheduled[scheduled.length - 1]);
        if (filler) {
          const fillerDuration = Math.round(filler.duration * durationMultiplierFor(pace, filler.category));
          const fdur = Math.min(fillerDuration, timeLeft);
          if (fdur >= minBlock) {
            if (filler.sourcePlaceName) removePlaceByName(filler.sourcePlaceName);
            const loc = filler.location ?? currentLocation;
            const s: Scheduled = {
              title: filler.title,
              location: loc,
              description: filler.description ?? 'Stretch your legs here.',
              category: filler.category,
              startMin: currentMin,
              endMin: currentMin + fdur,
              url: ensureGoogleMapsUrl(filler.url, loc || city, filler.title),
              lat: filler.lat,
              lng: filler.lng,
            };
            s.travelMinFromPrev = 0;
            s.travelModeFromPrev = 'walk';
            scheduled.push(s);
            registerStop(s);
            currentLocation = s.location || currentLocation;
            currentMin += fdur;
            refreshTravelMetadata();
            continue;
          }
        }
        break;
      }

      // Commit chosen suggestion
      const s: Scheduled = {
        title: place.name,
        location: place.location || place.neighborhood || city,
        description: place.description ?? 'Nearby highlight.',
        category: cat,
        startMin: start,
        endMin: end,
        url: place.url || undefined,
        lat: place.lat,
        lng: place.lng,
      };
      s.travelMinFromPrev = travel;
      s.travelModeFromPrev = recommendedTravelMode(travel);
      scheduled.push(s);
      registerStop(s, place);
      const idx = suggestionStream.indexOf(place);
      if (idx >= 0) suggestionStream.splice(idx, 1);
      currentLocation = s.location || currentLocation;
      currentMin = end;
      refreshTravelMetadata();
    }
  }

  // Segment timeline
  currentLocation = anchors.length ? (anchors[0].location || preferredArea || city) : (preferredArea || city);

  if (anchors.length > 0) {
    const first = anchors[0];
    await fillUntil(first.startMin);

    const travelToFirst = travelFromTo(currentLocation, first.location || city);
    const firstStart = Math.max(first.startMin, currentMin + travelToFirst);
    const firstEnd   = firstStart + (first.endMin - first.startMin);
    const firstTravel = Math.max(0, firstStart - currentMin);
    const firstAnchor: Scheduled = {
      ...first,
      startMin: firstStart,
      endMin: firstEnd,
      travelMinFromPrev: firstTravel,
      travelModeFromPrev: recommendedTravelMode(firstTravel),
    };
    scheduled.push(firstAnchor);
    markMealScheduled(firstAnchor.category);
    registerAreaForStop(firstAnchor, { isAnchor: true });
    const firstCatKey = (firstAnchor.category || 'misc').toLowerCase();
    categoryCounts.set(firstCatKey, 1 + (categoryCounts.get(firstCatKey) || 0));
    usedNameKeys.add(normName(firstAnchor.title));
    currentLocation = firstAnchor.location || currentLocation;
    currentMin = firstAnchor.endMin;
    refreshTravelMetadata();

    for (let i = 1; i < anchors.length; i++) {
      const next = anchors[i];
      await fillUntil(next.startMin);

      const travelToNext = travelFromTo(currentLocation, next.location || city);
      const nextStart = Math.max(next.startMin, currentMin + travelToNext);
      const nextEnd   = nextStart + (next.endMin - next.startMin);
      const nextTravel = Math.max(0, nextStart - currentMin);
      const nextAnchor: Scheduled = {
        ...next,
        startMin: nextStart,
        endMin: nextEnd,
        travelMinFromPrev: nextTravel,
        travelModeFromPrev: recommendedTravelMode(nextTravel),
      };
      scheduled.push(nextAnchor);
      markMealScheduled(nextAnchor.category);
      registerAreaForStop(nextAnchor, { isAnchor: true });
      const catKey = (nextAnchor.category || 'misc').toLowerCase();
      categoryCounts.set(catKey, 1 + (categoryCounts.get(catKey) || 0));
      usedNameKeys.add(normName(nextAnchor.title));
      currentLocation = nextAnchor.location || currentLocation;
      currentMin = nextAnchor.endMin;
      refreshTravelMetadata();
    }
  }

  await fillUntil(DAY_END_MIN);

  scheduledAreaCounts.clear();
  areaPartnerNeeds.clear();

  scheduled.sort((a, b) => a.startMin - b.startMin);
  ensureLunchStop();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  ensureMinimumStops();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  ensureNineToFiveCoverage();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  ensureDinnerStop();
  ensureMealExpectations();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  rebuildTrackingState();
  ensureLunchStop();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  pruneSoloNeighborhoodStops();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  rebuildTrackingState();
  ensureMinimumStops();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  ensureNineToFiveCoverage();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  ensureMorningKickoff();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  ensureDinnerStop();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  rebuildTrackingState();
  ensureLunchStop();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  await fillGapsWithActivities();
  scheduled.sort((a, b) => a.startMin - b.startMin);
  rebuildTrackingState();
  recomputeTravelMetadata(scheduled, city);
  await applyAccurateTravelTimes(scheduled);

  const finalStops: PlanStop[] = [];
  let previous: Scheduled | null = null;
  for (const p of scheduled) {
    if (previous) {
      const rawGap = Math.max(0, p.startMin - previous.endMin);
      let travelMin = p.travelMinFromPrev ?? minutesTravel(previous.location || city, p.location || city);
      const travelLimit = (previous.isAnchor || p.isAnchor) ? MAX_ANCHOR_TRAVEL_MIN : MAX_NON_ANCHOR_TRAVEL_MIN;
      travelMin = Math.min(Math.max(0, travelMin), travelLimit);
      const actualTravel = Math.min(travelMin, rawGap || travelMin);
      const slack = Math.max(0, rawGap - actualTravel);

      if (actualTravel > 0) {
        const travelMode = recommendedTravelMode(actualTravel);
        const travelEmoji = travelMode === 'walk' ? '🚶‍♂️' : '🚇';
        finalStops.push({
          time: '',
          title: 'TRANSIT_NOTE',
          location: '',
          description: `${travelEmoji} ${Math.max(1, Math.round(actualTravel))} min ${travelMode === 'walk' ? 'walk' : 'transit'} to next stop`,
        });
      }

      // Any remaining slack should already be filled earlier in the pipeline.
    }

    const start = new Date(minutesOf(date, p.startMin));
    const end = new Date(minutesOf(date, p.endMin));
    const locationLabel = resolveDisplayLocation(p.location, city, previous?.location);
    const url = ensureGoogleMapsUrl(p.url, locationLabel, p.title);

    finalStops.push({
      time: `${fmtTime(start)} – ${fmtTime(end)}`,
      title: p.title,
      location: locationLabel,
      description: p.description ?? '',
      url,
    });
    previous = p;
  }

  const timelineWithoutNotes = finalStops.filter(s => s.title !== 'TRANSIT_NOTE');

  try {
    const polished = await formatTimelineWithLLM(timelineWithoutNotes, { city: inputs.city, vibes: inputs.vibes, pace: inputs.pace });
    return mergeTransitNotes(polished, finalStops);
  } catch {
    return mergeTransitNotes(timelineWithoutNotes, finalStops);
  }
}

/* ============================
   Support functions
============================ */

function minutesTravel(from: string, to: string): number {
  if (!from || !to || from === to) return 0;
  try {
    const m = travelMinutesBetween(from, to);
    if (typeof m === 'number' && isFinite(m)) return Math.max(0, Math.round(m));
  } catch {}
  // Fallback heuristic
  const F = from.toLowerCase();
  const T = to.toLowerCase();
  const crossRiver = (F.includes('brooklyn') && !T.includes('brooklyn')) || (!F.includes('brooklyn') && T.includes('brooklyn'));
  if (crossRiver) return 30;
  if (F && T && (F.includes('village') && T.includes('village'))) return 10;
  return 20;
}

function recomputeTravelMetadata(list: Scheduled[], city: string) {
  const normalizeLocation = (value?: string) =>
    (value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  let prev: Scheduled | null = null;
  for (const stop of list) {
    if (!prev) {
      const initialGap = Math.max(0, stop.startMin - DAY_START_MIN);
      stop.travelMinFromPrev = initialGap;
      stop.travelModeFromPrev = recommendedTravelMode(initialGap);
    } else {
      const gap = Math.max(0, stop.startMin - prev.endMin);
      const estimate = minutesTravel(prev.location || city, stop.location || city);
      const prevLoc = normalizeLocation(prev.location);
      const nextLoc = normalizeLocation(stop.location);
      const sameLocation = prevLoc && nextLoc && prevLoc === nextLoc;
      const sameTitle = prev.title === stop.title;
      const baseMin = sameTitle ? 0 : (sameLocation ? 10 : 12);

      let travel = Math.max(gap, estimate);
      if (!isFinite(travel) || travel < baseMin) {
        travel = baseMin;
      }
      if (travel <= 0) {
        const prevArea = areaKeyFromString(prev.location || '');
        const nextArea = areaKeyFromString(stop.location || '');
        const locationsDiffer = prevLoc !== nextLoc;
        if (locationsDiffer || (prevArea && nextArea && prevArea !== nextArea)) {
          travel = Math.max(baseMin, estimate || 12);
        } else {
          travel = Math.max(baseMin, gap, estimate);
        }
      }

      const requiredStart = prev.endMin + travel;
      if (stop.startMin < requiredStart) {
        const shift = requiredStart - stop.startMin;
        stop.startMin += shift;
        stop.endMin += shift;
      }
      const actualGap = Math.max(0, stop.startMin - prev.endMin);
      stop.travelMinFromPrev = actualGap;
      stop.travelModeFromPrev = recommendedTravelMode(actualGap);
    }
    prev = stop;
  }
  if (list.length) {
    const first = list[0];
    if ((first.travelMinFromPrev ?? 0) < 0) first.travelMinFromPrev = 0;
    first.travelModeFromPrev = recommendedTravelMode(first.travelMinFromPrev || 0);
  }
}

// HARD-SKIP aware selection (skips if likely closed at planned slot)
// HARD-SKIP aware selection (skips closed items or lunchy items before 11:30)
function pickNextSuggestion(
  categories: string[],
  candidates: Place[],
  city: string,
  pace: Pace,
  wouldExceedCategoryMinutes: (cat: string, addMin: number) => boolean,
  score: (p: Place, cat: string) => number,
  opts: {
    currentMin: number;
    currentLocation: string;
    dateISO: string;
    travelFromTo: (from: string, to: string) => number;
    previousCategory?: string;
    previousIsMeal?: boolean;
    previousIsMorningMeal?: boolean;
    previousStop?: Scheduled | null;
    scheduled: Scheduled[];
    isWeekend: boolean;
    brunchChosen: boolean;
    lunchChosen: boolean;
    areaLock?: { area: string; remaining: number };
  }
): { place: Place; category: string } | null {
  for (const cat of categories) {
    let best: Place | null = null;
    let bestScore = Infinity;

    for (const p of candidates) {
      const areaKey = areaKeyFromPlace(p);
      if (opts.areaLock?.area) {
        if (!areaKey || areaKey !== opts.areaLock.area) continue;
      }
      const desiredCat = (cat || '').toLowerCase();
      if (!opts.isWeekend && desiredCat === 'brunch') continue;
      if (opts.isWeekend) {
        if (opts.lunchChosen && desiredCat === 'brunch') continue;
        if (opts.brunchChosen && desiredCat === 'lunch') continue;
      }
      const dur = plannedDurationMinutes(p, desiredCat, pace);
      if (wouldExceedCategoryMinutes(cat, dur)) continue;

      const placeCat = (p.category || '').toLowerCase();
      if (!isBarCategory(desiredCat) && isBarCategory(placeCat)) {
        continue;
      }
      if (isFoodCategory(desiredCat) && placeCat && placeCat !== desiredCat) {
        continue;
      }
      if (!isFoodCategory(desiredCat) && isFoodCategory(placeCat)) {
        continue;
      }

      const candidateIsMeal = isMealCategory(desiredCat, p);
      const candidateIsMorning = isMorningMealCategory(desiredCat, p);
      if (opts.previousIsMorningMeal && candidateIsMorning) {
        continue;
      }
      if (opts.previousIsMeal && candidateIsMeal) {
        continue;
      }

      const lastStop = opts.previousStop ?? (opts.scheduled.length ? opts.scheduled[opts.scheduled.length - 1] : null);

      const travel = opts.travelFromTo(opts.currentLocation || city, p.location || p.neighborhood || city);
      if (!travelWithinLimit(travel, false)) continue;
      const start  = opts.currentMin + travel;
      const end    = start + dur;

      if (desiredCat !== 'breakfast' && desiredCat !== 'coffee' && start < GENERAL_ACTIVITY_START_MIN) {
        continue;
      }
      if (desiredCat === 'breakfast') {
        if (start < BREAKFAST_EARLIEST_MIN || start >= BREAKFAST_LATEST_MIN) continue;
      }
      if (desiredCat === 'brunch') {
        if (start < BRUNCH_START_MIN || start >= BRUNCH_END_MIN) continue;
      }
      if (desiredCat === 'lunch') {
        if (start < LUNCH_START_MIN || start >= LUNCH_WINDOW_END) continue;
      }
      if (candidateIsMeal && start >= AFTERNOON_START_MIN && start < AFTERNOON_END_MIN) {
        continue;
      }
      if (desiredCat === 'dinner' && start < DINNER_START_MIN) {
        continue;
      }
      if (candidateIsMeal && desiredCat !== 'breakfast' && desiredCat !== 'brunch' && desiredCat !== 'lunch' && desiredCat !== 'dinner') {
        if (start < DINNER_START_MIN) continue;
      }
      let sc = score(p, cat);
      if (lastStop && isFoodCategory(lastStop.category) && isFoodCategory(desiredCat)) {
        const gap = start - lastStop.endMin;
        if (gap < 90) {
          let penalty = 6.0;
          if (desiredCat === 'lunch' && start < 12 * 60) penalty += 3.0;
          sc += penalty;
        }
      }
      // 1) HARD SKIP: lunchy items (pizza, burgers, sandwiches, tacos, etc.) before 11:30 AM
      if (start < LUNCH_START_MIN && isLunchy(p, cat)) {
        continue;
      }
      if (isBarCategory(desiredCat) && start < FIVE_PM_MIN) {
        continue;
      }

      // 2) HARD SKIP: closed during planned window (requires enriched hours data)
      const hoursCategory = (isBarCategory(desiredCat) || isFoodCategory(desiredCat)) ? cat : (p.category || cat);
      if (isLikelyClosedDuring(p.hours, hoursCategory, start, end, opts.dateISO) > 0) {
        continue;
      }

      if (sc < bestScore) { best = p; bestScore = sc; }
    }

    if (best) return { place: best, category: cat };
  }
  return null;
}

// Returns >0 if closed in [start,end]; 0 if open or unknown/unparsed
function isLikelyClosedDuring(
  hours: Place['hours'] | undefined,
  category: string | undefined,
  startMin: number,
  endMin: number,
  dateISO: string
): number {
  if (hours?.periods?.length) {
    const closedByPeriods = isClosedByPeriods(hours.periods, startMin, endMin, dateISO);
    if (closedByPeriods != null) {
      return closedByPeriods ? 2 : 0;
    }
  }

  if (hours?.weekdayText?.length) {
    const weekdayText = hours.weekdayText;
    const d = new Date(dateISO + "T12:00:00");
    if (!Number.isNaN(d.getTime())) {
      const js = d.getDay(); // 0..6
      const names = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const line = weekdayText.find(t => t.toLowerCase().startsWith(names[js].toLowerCase()));
      if (line) {
        const ranges = Array.from(
          line.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi)
        ).slice(0, 4);
        const toMin = (h: number, m: number, ap: string) => {
          h = h % 12;
          if (ap.toUpperCase() === "PM") h += 12;
          return h * 60 + m;
        };
        if (ranges.length) {
          const windows = ranges.map(m => {
            const h1 = parseInt(m[1],10), mm1 = m[2]?parseInt(m[2],10):0, ap1 = m[3];
            const h2 = parseInt(m[4],10), mm2 = m[5]?parseInt(m[5],10):0, ap2 = m[6];
            return [toMin(h1,mm1,ap1), toMin(h2,mm2,ap2)] as [number, number];
          });
          const overlaps = windows.some(([lo,hi]) => !(endMin <= lo || startMin >= hi));
          if (overlaps) return 0;
          return 2;
        }
      }
    }
  }

  const approx = approximateHoursForCategory(category);
  if (approx?.length) {
    const overlaps = approx.some(([lo, hi]) => !(endMin <= lo || startMin >= hi));
    return overlaps ? 0 : 1;
  }
  return 0;
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function approximateHoursForCategory(category?: string): Array<[number, number]> | null {
  if (!category) return null;
  const c = category.toLowerCase();
  switch (c) {
    case 'breakfast':
      return [[BREAKFAST_EARLIEST_MIN, BREAKFAST_LATEST_MIN]];
    case 'coffee':
      return [[BREAKFAST_EARLIEST_MIN, BREAKFAST_LATEST_MIN]];
    case 'brunch':
      return [[BRUNCH_START_MIN, BRUNCH_END_MIN]];
    case 'lunch':
      return [[LUNCH_START_MIN, LUNCH_WINDOW_END]];
    case 'snack':
      return [[12 * 60, 18 * 60]];
    case 'dinner':
      return [[DINNER_START_MIN, 22 * 60 + 30]];
    case 'bar':
    case 'drinks':
      return [
        [17 * 60, MINUTES_IN_DAY],
        [0, 2 * 60]
      ];
    case 'museum':
      return [[10 * 60, 17 * 60 + 30]];
    case 'gallery':
      return [[11 * 60, 19 * 60]];
    case 'design':
    case 'boutique':
    case 'art':
      return [[11 * 60, 19 * 60]];
    case 'park':
    case 'walk':
    case 'view':
      return [[7 * 60, 20 * 60]];
    case 'market':
      return [[9 * 60, 18 * 60]];
    case 'shopping':
      return [[10 * 60, 21 * 60]];
    case 'show':
      return [[18 * 60, 23 * 60 + 30]];
    default:
      return null;
  }
}

function isClosedByPeriods(
  periods: NonNullable<PlaceHours['periods']>,
  startMin: number,
  endMin: number,
  dateISO: string
): boolean | null {
  if (!periods.length) return null;
  const d = new Date(dateISO + "T12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const targetDay = d.getDay(); // 0..6 (Sunday start)
  const targetStartAbs = targetDay * MINUTES_IN_DAY + startMin;
  const targetEndAbs = targetDay * MINUTES_IN_DAY + endMin;
  const toMinutes = (time?: string) => {
    if (!time) return 0;
    const h = parseInt(time.slice(0, 2), 10) || 0;
    const m = parseInt(time.slice(2, 4) || "0", 10) || 0;
    return h * 60 + m;
  };

  let sawInterval = false;
  for (const period of periods) {
    if (!period?.open || typeof period.open.day !== 'number') continue;
    const openDay = ((period.open.day % 7) + 7) % 7;
    const openMin = toMinutes(period.open.time);
    const openAbs = openDay * MINUTES_IN_DAY + openMin;

    const close = period.close;
    let closeAbs: number;
    if (close) {
      const closeDay = typeof close.day === 'number' ? ((close.day % 7) + 7) % 7 : openDay;
      const closeMin = toMinutes(close.time);
      closeAbs = closeDay * MINUTES_IN_DAY + closeMin;
      while (closeAbs <= openAbs) {
        closeAbs += MINUTES_IN_DAY;
      }
    } else {
      closeAbs = openDay * MINUTES_IN_DAY + MINUTES_IN_DAY;
      if (closeAbs <= openAbs) {
        closeAbs = openAbs + MINUTES_IN_DAY;
      }
    }

    sawInterval = true;

    for (const offset of [-MINUTES_IN_WEEK, 0, MINUTES_IN_WEEK]) {
      const windowStart = openAbs + offset;
      const windowEnd = closeAbs + offset;
      if (windowEnd <= targetStartAbs) continue;
      if (windowStart >= targetEndAbs) continue;
      return false;
    }
  }

  return sawInterval ? true : null;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/* ============================
   Exports (back-compat)
============================ */

export const buildItinerary = plan;
export default plan;
