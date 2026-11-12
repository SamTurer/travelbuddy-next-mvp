import type { Place } from './places';
import type { Pace } from './types';

export type LockInput =
  | string
  | {
      title?: string;
      location?: string;
      description?: string;
      time?: string;
      start?: string;
      category?: string;
      duration_min?: number;
    };

export type MustSlot = 'breakfast' | 'lunch' | 'dinner' | 'drinks' | 'activity' | 'show';

export type ParsedMust = {
  raw: string;
  title: string;
  place: Place | null;
  lat?: number;
  lng?: number;
  neighborhood?: string;
  slot: MustSlot;
  category: string;
  daypart: 'morning' | 'afternoon' | 'evening' | null;
  pinnedStart: number | null;
  duration: number;
  plainText: boolean;
  booking?: Place['booking'];
  bookingNote?: string;
  bookingUrl?: string;
  /** Internal planner flag. */
  claimed?: boolean;
};

type GazetteerEntry = {
  keys: string[];
  name: string;
  lat: number;
  lng: number;
  neighborhood: string;
  category: string;
  duration: number;
  booking?: Place['booking'];
  bookingNote?: string;
};

/**
 * Coordinates for places people ask for that are not on the trusted list.
 * Used only to place an explicit must-do. Never added to the default pool.
 */
const GAZETTEER: GazetteerEntry[] = [
  {
    keys: ['hamilton', 'richard rodgers theatre', 'richard rodgers theater'],
    name: 'Hamilton',
    lat: 40.7592,
    lng: -73.9866,
    neighborhood: 'Theater District',
    category: 'show',
    duration: 165,
    booking: 'tickets_required',
    bookingNote: 'Broadway show at the Richard Rodgers Theatre. Tickets required.',
  },
  {
    keys: ['carbone'],
    name: 'Carbone',
    lat: 40.7279,
    lng: -74.0003,
    neighborhood: 'Greenwich Village',
    category: 'dinner',
    duration: 105,
    booking: 'hard_to_book',
    bookingNote: 'Books out. Reserve ahead.',
  },
  {
    keys: ['the met', 'met', 'met museum', 'met fifth avenue', 'metropolitan museum', 'metropolitan museum of art'],
    name: 'The Metropolitan Museum of Art',
    lat: 40.7794,
    lng: -73.9632,
    neighborhood: 'Upper East Side',
    category: 'museum',
    duration: 120,
    booking: 'tickets_required',
    bookingNote: 'Timed entry tickets.',
  },
  {
    keys: ['comedy cellar'],
    name: 'Comedy Cellar',
    lat: 40.7302,
    lng: -74.0004,
    neighborhood: 'Greenwich Village',
    category: 'show',
    duration: 120,
    booking: 'tickets_required',
    bookingNote: 'Shows are ticketed.',
  },
];

const MEAL_WORDS: { re: RegExp; slot: MustSlot }[] = [
  { re: /\b(breakfast(?:\s*time)?)\b/i, slot: 'breakfast' },
  { re: /\b(brunch)\b/i, slot: 'breakfast' },
  { re: /\b(lunch(?:\s*time)?)\b/i, slot: 'lunch' },
  { re: /\b(dinner(?:\s*time)?|supper(?:\s*time)?)\b/i, slot: 'dinner' },
  { re: /\b(drinks|cocktails)\b/i, slot: 'drinks' },
  { re: /\b(coffee|café|cafe)\b/i, slot: 'breakfast' },
  { re: /\b(musical|broadway|hamilton)\b/i, slot: 'show' },
  { re: /\b(show)\b/i, slot: 'show' },
];

/** Lowercase, strip punctuation, and drop "the" / "a" / "an" so "The Met" and "met" compare equal. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’]/g, '')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost);
      previous = current;
    }
  }
  return row[b.length];
}

/** Accept a match at this score or higher. Exact names and aliases are 100. */
export const MATCH_THRESHOLD = 80;

export function scorePlaceName(query: string, placeName: string): number {
  const left = normalizeName(query);
  const right = normalizeName(placeName);
  if (!left || !right) return 0;
  if (left === right) return 100;
  const leftTokens = left.split(' ');
  const rightTokens = right.split(' ');
  if (leftTokens.length === rightTokens.length && leftTokens.every((token, index) => token === rightTokens[index])) {
    return 100;
  }
  if (
    leftTokens.length >= 2 &&
    leftTokens.every((token) => rightTokens.includes(token)) &&
    rightTokens.every((token) => leftTokens.includes(token))
  ) {
    return 92;
  }
  // "met museum" covers "metropolitan museum" when every query token is a prefix of a candidate token.
  if (leftTokens.length >= 2 && leftTokens.every((token) => rightTokens.some((candidate) => candidate.startsWith(token) && token.length >= 3))) {
    const overlap = leftTokens.filter((token) => rightTokens.some((candidate) => candidate.startsWith(token))).length;
    if (overlap / Math.max(rightTokens.length, 1) >= 0.5) return 90;
  }
  if (left.length >= 4 && (right.startsWith(left) || left.startsWith(right)) && Math.abs(left.length - right.length) <= 4) {
    return 88;
  }
  // "levain" is the name people use for "Levain Bakery". Only a single distinctive word.
  if (leftTokens.length === 1 && left.length >= 5 && (right.startsWith(`${left} `) || left.startsWith(`${right} `))) {
    return 86;
  }
  if (left.length >= 5 && right.length >= 5 && levenshtein(left, right) <= 2) return 84;
  const shared = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  if (leftTokens.length >= 2 && shared >= 2 && shared / union >= 0.67) return 82;
  return 0;
}

export function scorePlace(query: string, place: Place): number {
  const names = [place.name, ...(place.aliases ?? [])];
  return names.reduce((best, name) => Math.max(best, scorePlaceName(query, name)), 0);
}

function bestPlace(query: string, places: Place[]): Place | null {
  let best: { place: Place; score: number } | null = null;
  const scored: { place: Place; score: number }[] = [];
  for (const place of places) {
    const score = scorePlace(query, place);
    if (score <= 0) continue;
    scored.push({ place, score });
    if (!best || score > best.score || (score === best.score && place.name.length < best.place.name.length)) {
      best = { place, score };
    }
  }
  if (!best || best.score < MATCH_THRESHOLD) return null;
  const ties = scored.filter((item) => item.score === best!.score);
  // A nickname that fits two places is not a match. Exact names still win.
  if (ties.length > 1 && best.score < 100) return null;
  return best.place;
}

function gazetteerMatch(query: string): GazetteerEntry | null {
  const normalized = normalizeName(query);
  if (!normalized) return null;
  return (
    GAZETTEER.find((entry) => entry.keys.some((key) => normalizeName(key) === normalized)) ??
    null
  );
}

type RawClock = { hour: number; minute: number; ampm: 'am' | 'pm' | null };

function parseClockToken(value: string): RawClock | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  const marker = match[3]?.toLowerCase().replace(/\./g, '') ?? null;
  const ampm = marker === 'am' || marker === 'pm' ? marker : null;
  return { hour, minute, ampm };
}

function findClock(text: string): RawClock | null {
  if (/\b(noon|noontime)\b/i.test(text)) return { hour: 12, minute: 0, ampm: 'pm' };
  if (/\bmidnight\b/i.test(text)) return { hour: 12, minute: 0, ampm: 'am' };
  const patterns = [
    /\b(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?)\b/i,
    /\b(\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?))\b/i,
    /\b(?:at|around|about|by)\s+(\d{1,2}(?::\d{2})?(?:\s*(?:a\.?m\.?|p\.?m\.?))?)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const clock = parseClockToken(match[1]);
      if (clock) return clock;
    }
  }
  return null;
}

export function resolveClock(
  clock: RawClock,
  context: { slot?: MustSlot | null; daypart?: ParsedMust['daypart']; categories?: string[] }
): number {
  const { hour, minute, ampm } = clock;
  if (ampm === 'am') return (hour % 12) * 60 + minute;
  if (ampm === 'pm') return (hour % 12) * 60 + minute + 12 * 60;
  if (hour >= 13) return hour * 60 + minute;
  if (hour === 0) return minute;

  const categories = new Set(context.categories ?? []);
  const slot = context.slot;
  const daypart = context.daypart;
  const evening =
    slot === 'dinner' ||
    slot === 'drinks' ||
    slot === 'show' ||
    daypart === 'evening' ||
    categories.has('dinner') ||
    categories.has('drinks') ||
    categories.has('show');
  const morningish =
    slot === 'breakfast' ||
    daypart === 'morning' ||
    categories.has('breakfast') ||
    categories.has('coffee') ||
    categories.has('bakery') ||
    categories.has('brunch');
  const midday = slot === 'lunch' || daypart === 'afternoon' || categories.has('lunch') || categories.has('museum');

  if (evening && hour >= 1 && hour <= 11) return (hour + 12) * 60 + minute;
  if (midday && !morningish) {
    if (hour === 12) return 12 * 60 + minute;
    if (hour >= 1 && hour <= 7) return (hour + 12) * 60 + minute;
  }
  if (morningish && hour >= 6 && hour <= 11) return hour * 60 + minute;
  if (daypart === 'afternoon' && hour >= 1 && hour <= 7) return (hour + 12) * 60 + minute;
  if (hour >= 1 && hour <= 7) return (hour + 12) * 60 + minute;
  return hour * 60 + minute;
}

function daypartOf(text: string): ParsedMust['daypart'] {
  if (/\b(evening|tonight|at night)\b/i.test(text)) return 'evening';
  if (/\bafternoon\b/i.test(text)) return 'afternoon';
  if (/\bmorning\b/i.test(text)) return 'morning';
  return null;
}

function slotWord(text: string): MustSlot | null {
  for (const entry of MEAL_WORDS) {
    if (entry.re.test(text)) return entry.slot;
  }
  return null;
}

function cleanTitle(text: string): string {
  return text
    .replace(/\b(noontime|noon|midnight)\b/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?\b/gi, ' ')
    .replace(/\b(?:at|around|about|by)\s+\d{1,2}(?::\d{2})?(?:\s*(?:a\.?m\.?|p\.?m\.?))?\b/gi, ' ')
    .replace(/\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, ' ')
    .replace(/\b(in the|around|about|at|for)\b/gi, ' ')
    .replace(/\b(breakfast|brunch|lunch|dinner|supper)(?:\s*time)?\b/gi, ' ')
    .replace(/\b(drinks|cocktails|coffee|show|musical|broadway|morning|afternoon|evening|tonight)\b/gi, ' ')
    .replace(/[^a-zA-Z0-9'&. -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slotFromPlace(categories: string[], daypart: ParsedMust['daypart'], word: MustSlot | null): MustSlot {
  if (word === 'show') return 'show';
  if (word === 'dinner' || word === 'lunch' || word === 'breakfast' || word === 'drinks') return word;
  if (categories.includes('show')) return 'show';
  const morningFood = categories.some((category) => ['breakfast', 'coffee', 'bakery', 'brunch'].includes(category));
  if (daypart === 'morning' && morningFood) return 'breakfast';
  if (daypart === 'evening' && categories.includes('dinner')) return 'dinner';
  if (daypart === 'afternoon' || daypart === 'morning') return 'activity';
  if (categories.includes('dinner')) return 'dinner';
  if (categories.includes('drinks') && categories.length === 1) return 'drinks';
  if (categories.includes('lunch') && !categories.includes('breakfast')) return 'lunch';
  if (morningFood) return 'breakfast';
  return 'activity';
}

function defaultDuration(slot: MustSlot, pace: Pace, place: Place | null, hint?: number): number {
  if (slot === 'show') return Math.min(180, Math.max(150, hint ?? 165));
  if (hint && hint > 0) return hint;
  if (place) {
    const min = place.duration_min || 45;
    const max = place.duration_max || min;
    if (pace === 'chill') return max;
    if (pace === 'max') return min;
    return Math.round((min + max) / 2);
  }
  if (slot === 'dinner') return pace === 'chill' ? 120 : pace === 'max' ? 75 : 90;
  if (slot === 'lunch') return pace === 'chill' ? 90 : pace === 'max' ? 60 : 75;
  if (slot === 'breakfast') return pace === 'chill' ? 60 : 45;
  if (slot === 'drinks') return 70;
  return pace === 'chill' ? 120 : pace === 'max' ? 70 : 90;
}

export function parseMustDo(lock: LockInput, places: Place[], pace: Pace = 'balanced'): ParsedMust | null {
  const asObject = typeof lock === 'string' ? null : lock;
  const raw = typeof lock === 'string' ? lock : [lock?.title, lock?.time, lock?.description, lock?.category, lock?.location].filter(Boolean).join(' ');
  const titleSource = typeof lock === 'string' ? lock : lock?.title || '';
  if (!raw.trim() || !titleSource.trim()) return null;

  const contextText = `${titleSource} ${asObject?.description ?? ''} ${asObject?.category ?? ''} ${asObject?.location ?? ''}`;
  const daypart = daypartOf(contextText);
  const word = slotWord(contextText);
  const explicit = asObject?.time || asObject?.start;
  const clock = (explicit && parseClockToken(explicit)) || findClock(contextText);
  const name = cleanTitle(titleSource) || cleanTitle(raw);
  if (!name) return null;

  const place = bestPlace(name, places);
  const gaz = place ? null : gazetteerMatch(name);
  const categories = place?.categories ?? (gaz ? [gaz.category] : word ? [word === 'show' ? 'show' : word] : []);
  const slot = slotFromPlace(categories, daypart, word);
  const pinnedStart = clock
    ? resolveClock(clock, { slot, daypart, categories })
    : null;

  const hint = asObject?.duration_min;
  const duration = defaultDuration(slot, pace, place, gaz?.duration ?? hint);

  return {
    raw,
    title: place?.name ?? gaz?.name ?? raw.trim(),
    place,
    lat: place?.lat ?? gaz?.lat,
    lng: place?.lng ?? gaz?.lng,
    neighborhood: place?.neighborhood ?? gaz?.neighborhood ?? asObject?.location,
    slot,
    category: gaz?.category ?? place?.category ?? (slot === 'show' ? 'show' : slot),
    daypart,
    pinnedStart,
    duration,
    plainText: !place && !gaz,
    booking: gaz?.booking ?? place?.booking,
    bookingNote: gaz?.bookingNote ?? place?.booking_note,
    bookingUrl: place?.booking_url,
  };
}

/** "for lunch" when the phrase names a meal but not a clock. A clock still wins. */
export function matchDetail(item: Pick<ParsedMust, 'pinnedStart' | 'slot'>): string | undefined {
  if (item.pinnedStart != null) return undefined;
  if (item.slot === 'lunch' || item.slot === 'dinner' || item.slot === 'breakfast' || item.slot === 'drinks') {
    return `for ${item.slot}`;
  }
  return undefined;
}

/** Sentence for the must-do screen: the place we matched, where it is, and the time we kept. */
export function describeMatch(item: Pick<ParsedMust, 'title' | 'neighborhood' | 'pinnedStart' | 'slot'>): string {
  const where = item.neighborhood ? ` in ${item.neighborhood}` : '';
  const when = item.pinnedStart != null ? ` at ${formatClock(item.pinnedStart)}` : '';
  const detail = matchDetail(item);
  return `${item.title}${where}${when}${detail ? ` ${detail}` : ''}`;
}

function formatClock(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  return `${hour}:${minute.toString().padStart(2, '0')} ${suffix}`;
}

export function parseMustDos(locks: LockInput[] | undefined, places: Place[], pace: Pace = 'balanced'): ParsedMust[] {
  const parsed: ParsedMust[] = [];
  for (const lock of locks ?? []) {
    const item = parseMustDo(lock, places, pace);
    if (item) parsed.push(item);
  }
  return parsed;
}
