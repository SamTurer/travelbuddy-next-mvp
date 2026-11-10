import { grokComplete, parseJsonObject, xaiEnabled } from './grok';
import { hoodById, hoodForPlace, hoodLabel, focusHoodId } from './neighborhoods';
import {
  ACTIVITY_CATEGORIES,
  BOOK_AHEAD_KINDS,
  BOOKING_LABEL,
  BREAKFAST_CATEGORIES,
  DINNER_CATEGORIES,
  DRINKS_CATEGORIES,
  LUNCH_CATEGORIES,
  getPlaces,
  hasCategory,
  isFoodPlace,
  peopleForPlace,
  visitFitsHours,
  type BookingKind,
  type Place,
} from './places';
import { parseMustDos, type ParsedMust } from './must-dos';
import { addedByYou, recommendedByAi, type RecommendedByPerson } from './recommenders';
import { dayMapsUrl, estimateLeg, routeLeg, type Leg } from './routing';
import { clamp, formatMinutes, formatRange, isWeekend, weekdayIndex } from './time';
import type { Pace } from './types';

export type { Pace };

export type PlanInput = {
  city?: string;
  date: string;
  vibes?: string[];
  pace?: Pace;
  focusArea?: string | null;
  locks?: Parameters<typeof parseMustDos>[0];
  /** Where the day starts. Used for the first leg only; it does not move meal times. */
  startLocation?: { lat: number; lng: number; label?: string } | null;
};

export type VisitRole = 'breakfast' | 'activity' | 'lunch' | 'dinner' | 'drinks' | 'show' | 'free';

export type ItineraryVisit = {
  role: VisitRole;
  title: string;
  startMin: number;
  endMin: number;
  neighborhood: string;
  description: string;
  note?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  hoodId?: string | null;
  source: 'curated' | 'must-do' | 'free' | 'ai';
  mustDo?: boolean;
  pinned: boolean;
  recommendedBy: RecommendedByPerson[];
  booking?: BookingKind;
  bookingNote?: string;
  bookingUrl?: string;
  warning?: string;
  leg: Leg | null;
};

export type RenderedStop = {
  time: string;
  title: string;
  location: string;
  description: string;
  url?: string;
  kind: 'place' | 'transit' | 'free';
  role?: VisitRole;
  placeId?: string;
  lat?: number;
  lng?: number;
  startMin?: number;
  endMin?: number;
  pinned?: boolean;
  source?: ItineraryVisit['source'];
  mustDo?: boolean;
  hoodId?: string | null;
  recommendedBy?: RecommendedByPerson[];
  note?: string;
  booking?: BookingKind;
  bookingNote?: string;
  bookingUrl?: string;
  warning?: string;
  mapsUrl?: string;
  leg?: Leg | null;
};

export type BookAheadItem = {
  title: string;
  time: string;
  booking: BookingKind;
  bookingLabel: string;
  bookingNote?: string;
  bookingUrl?: string;
};

export type Cluster = { primary: string; hoods: string[]; label: string };

export type Itinerary = {
  date: string;
  pace: Pace;
  vibes: string[];
  cluster: Cluster;
  visits: ItineraryVisit[];
  stops: RenderedStop[];
  warnings: string[];
  mapsUrl: string;
  bookAhead: BookAheadItem[];
  startLocation?: { lat: number; lng: number; label?: string } | null;
};

const PACE_SHAPE: Record<Pace, { morning: number; afternoon: number; drinks: boolean }> = {
  chill: { morning: 1, afternoon: 0, drinks: false },
  balanced: { morning: 1, afternoon: 1, drinks: true },
  max: { morning: 2, afternoon: 2, drinks: true },
};

const ROLE_ORDER: Record<VisitRole, number> = {
  breakfast: 0,
  activity: 1,
  lunch: 2,
  dinner: 3,
  show: 4,
  drinks: 5,
  free: 6,
};

type SlotRole = Exclude<VisitRole, 'free'>;

type Request = {
  role: SlotRole;
  must: ParsedMust | null;
  ideal: number;
  windowStart: number;
  windowEnd: number;
  duration: number;
  pinned: boolean;
};

type Chosen = Request & {
  title: string;
  place: Place | null;
  lat?: number;
  lng?: number;
  neighborhood: string;
  hoodId: string | null;
  description: string;
  note?: string;
  source: ItineraryVisit['source'];
  recommendedBy: RecommendedByPerson[];
  booking?: BookingKind;
  bookingNote?: string;
  bookingUrl?: string;
  startHint: number;
};

function dwell(place: Place | null, role: SlotRole, pace: Pace): number {
  if (role === 'show') return 165;
  const fallback = {
    chill: { breakfast: 60, activity: 120, lunch: 90, dinner: 120, drinks: 75, show: 165 },
    balanced: { breakfast: 45, activity: 90, lunch: 75, dinner: 90, drinks: 70, show: 165 },
    max: { breakfast: 40, activity: 70, lunch: 60, dinner: 75, drinks: 60, show: 165 },
  } as const;
  if (!place) return fallback[pace][role];
  const listedMin = place.duration_min || fallback[pace][role];
  const listedMax = Math.max(listedMin, place.duration_max || listedMin);
  const target = fallback[pace][role];
  if (pace === 'chill') return Math.max(target, listedMax);
  if (pace === 'max') {
    const floor = role === 'breakfast' ? 35 : 45;
    return Math.max(floor, Math.min(target, Math.max(listedMax, floor)));
  }
  return Math.min(Math.max(listedMax, target), Math.max(listedMin, target));
}

function categoriesFor(role: SlotRole): string[] {
  if (role === 'breakfast') return BREAKFAST_CATEGORIES;
  if (role === 'lunch') return LUNCH_CATEGORIES;
  if (role === 'dinner') return DINNER_CATEGORIES;
  if (role === 'drinks') return DRINKS_CATEGORIES;
  return ACTIVITY_CATEGORIES;
}

function isMeal(role: SlotRole): boolean {
  return role === 'breakfast' || role === 'lunch' || role === 'dinner';
}

function vibeScore(place: Place, vibes: string[]): number {
  const tags = new Set(place.vibe_tags);
  const energy = new Set(place.energy_tags);
  let score = 0;
  for (const vibe of vibes.length ? vibes : ['classic']) {
    if (vibe === 'classic') {
      if (tags.has('classic') || tags.has('sightseeing')) score += 3;
      if (energy.has('touristy')) score += 1;
    } else if (vibe === 'local') {
      if (tags.has('local')) score += 3;
      if (energy.has('local')) score += 2;
      if (energy.has('touristy')) score -= 2;
    } else if (vibe === 'curator') {
      if (tags.has('specialty') || tags.has('modern') || tags.has('art') || tags.has('authentic')) score += 2;
      if (energy.has('aesthetic') || energy.has('quiet')) score += 1;
      if (energy.has('touristy')) score -= 1;
      score += 1;
    }
  }
  return score;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 33 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function openFor(place: Place, weekday: number, start: number, duration: number): boolean {
  return visitFitsHours(place, weekday, start, duration);
}

function supplyScore(
  ids: string[],
  places: Place[],
  hoodOf: Map<string, string | null>,
  weekday: number,
  pace: Pace,
  vibes: string[]
): number {
  const pool = places.filter((place) => ids.includes(hoodOf.get(place.id) || ''));
  let score = 0;
  const has = (cats: string[], start: number, duration: number, foodOk: boolean) =>
    pool.some(
      (place) =>
        (foodOk || !isFoodPlace(place)) &&
        hasCategory(place, cats) &&
        openFor(place, weekday, start, duration)
    );
  if (has(BREAKFAST_CATEGORIES, 9 * 60, 40, true)) score += 8;
  else score -= 30;
  if (has(LUNCH_CATEGORIES, 12 * 60 + 30, 60, true)) score += 8;
  else score -= 30;
  if (has(DINNER_CATEGORIES, 19 * 60, 75, true)) score += 8;
  else score -= 30;
  const activities = pool.filter(
    (place) => !isFoodPlace(place) && hasCategory(place, ACTIVITY_CATEGORIES) && openFor(place, weekday, 15 * 60, 60)
  );
  score += Math.min(activities.length, 8);
  const needed = PACE_SHAPE[pace].morning + PACE_SHAPE[pace].afternoon;
  if (activities.length < needed) score -= (needed - activities.length) * 4;
  if (pace !== 'chill') {
    if (has(DRINKS_CATEGORIES, 21 * 60, 60, true)) score += 5;
    else score -= 8;
  }
  if (pool.length) score += pool.reduce((sum, place) => sum + vibeScore(place, vibes), 0) / 40;
  return score;
}

function chooseCluster(
  focus: string | null,
  musts: ParsedMust[],
  places: Place[],
  hoodOf: Map<string, string | null>,
  weekday: number,
  pace: Pace,
  vibes: string[],
  date: string
): Cluster {
  const scoreOf = (ids: string[]) => supplyScore(ids, places, hoodOf, weekday, pace, vibes);
  const canFill = (ids: string[]) => {
    const pool = places.filter((place) => ids.includes(hoodOf.get(place.id) || ''));
    const open = (place: Place, start: number, duration: number) => visitFitsHours(place, weekday, start, duration);
    const hasMeal = (cats: string[], start: number, duration: number) =>
      pool.some((place) => hasCategory(place, cats) && open(place, start, duration));
    const activities = pool.filter(
      (place) => !isFoodPlace(place) && hasCategory(place, ACTIVITY_CATEGORIES) && open(place, 11 * 60, 50)
    );
    const drinksOk =
      pace === 'chill' || pool.some((place) => hasCategory(place, DRINKS_CATEGORIES) && open(place, 21 * 60, 50));
    const shape = PACE_SHAPE[pace];
    return (
      hasMeal(BREAKFAST_CATEGORIES, 9 * 60, 40) &&
      hasMeal(LUNCH_CATEGORIES, 12 * 60 + 30, 50) &&
      hasMeal(DINNER_CATEGORIES, 19 * 60, 60) &&
      activities.length >= shape.morning + shape.afternoon &&
      drinksOk
    );
  };
  const expand = (primary: string): string[] => {
    const hoods = [primary];
    const neighbors = hoodById(primary)?.adjacent ?? [];
    while (hoods.length < 3 && !canFill(hoods)) {
      let best: string | null = null;
      let bestScore = scoreOf(hoods);
      for (const neighbor of neighbors) {
        if (hoods.includes(neighbor)) continue;
        const score = scoreOf([...hoods, neighbor]);
        if (score > bestScore) {
          bestScore = score;
          best = neighbor;
        }
      }
      if (!best) break;
      hoods.push(best);
    }
    return hoods;
  };

  if (focus) {
    const hoods = expand(focus);
    return { primary: focus, hoods, label: hoodLabel(hoods) };
  }

  const mustHoods: string[] = [];
  for (const must of musts) {
    const hood = must.place ? hoodOf.get(must.place.id) : nearestHood(must.lat, must.lng);
    if (hood && !mustHoods.includes(hood)) mustHoods.push(hood);
  }
  if (mustHoods.length === 1) {
    const hoods = expand(mustHoods[0]);
    return { primary: mustHoods[0], hoods, label: hoodLabel(hoods) };
  }
  if (mustHoods.length >= 2) {
    const hoods = mustHoods.slice(0, 2);
    return { primary: hoods[0], hoods, label: hoodLabel(hoods) };
  }

  const options: { ids: string[]; score: number }[] = [];
  const seen = new Set<string>();
  for (const hood of hoodIds()) {
    const aloneKey = hood;
    if (!seen.has(aloneKey)) {
      seen.add(aloneKey);
      options.push({ ids: [hood], score: scoreOf([hood]) });
    }
    for (const neighbor of hoodById(hood)?.adjacent ?? []) {
      const key = [hood, neighbor].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ ids: [hood, neighbor].sort(), score: scoreOf([hood, neighbor]) - 0.5 });
    }
  }
  options.sort((a, b) => b.score - a.score || a.ids.join().localeCompare(b.ids.join()));
  const top = options[0]?.score ?? 0;
  const band = options.filter((option) => option.score >= top - 0.8);
  const picked = band[hashString(`${date}|${pace}|${vibes.join(',')}`) % Math.max(band.length, 1)] ?? options[0];
  const ids = picked?.ids ?? ['west-village'];
  return { primary: ids[0], hoods: ids, label: hoodLabel(ids) };
}

function hoodIds(): string[] {
  return ['harlem', 'uws', 'ues', 'central-park', 'midtown', 'chelsea', 'west-village', 'east-village', 'les', 'soho', 'chinatown', 'tribeca', 'fidi', 'williamsburg', 'dumbo', 'carroll', 'bushwick', 'astoria'];
}

function nearestHood(lat?: number, lng?: number): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  let best: { id: string; km: number } | null = null;
  for (const id of hoodIds()) {
    const hood = hoodById(id);
    if (!hood) continue;
    const km = Math.hypot(hood.lat - lat, hood.lng - lng);
    if (!best || km < best.km) best = { id, km };
  }
  return best && best.km < 0.08 ? best.id : best?.id ?? null;
}

function findTimedStart(
  place: Place,
  weekday: number,
  earliest: number,
  latest: number,
  ideal: number,
  duration: number,
  allowShorter: boolean
): { start: number; duration: number } | null {
  const tryDuration = (dur: number): number | null => {
    const points: number[] = [];
    for (let minute = ideal; minute <= latest; minute += 15) points.push(minute);
    for (let minute = ideal - 15; minute >= earliest; minute -= 15) points.push(minute);
    for (const start of points) {
      if (visitFitsHours(place, weekday, start, dur)) return start;
    }
    return null;
  };
  const full = tryDuration(duration);
  if (full != null) return { start: full, duration };
  if (!allowShorter) return null;
  const shorter = Math.max(30, Math.round(duration * 0.7));
  if (shorter >= duration) return null;
  const start = tryDuration(shorter);
  return start == null ? null : { start, duration: shorter };
}

function fromMust(must: ParsedMust, request: Request, hoodOf: Map<string, string | null>): Chosen {
  const place = must.place;
  return {
    ...request,
    title: must.title,
    place,
    lat: place?.lat ?? must.lat,
    lng: place?.lng ?? must.lng,
    neighborhood: place?.neighborhood ?? must.neighborhood ?? 'New York',
    hoodId: place ? hoodOf.get(place.id) ?? null : nearestHood(must.lat, must.lng),
    description: place?.description || `Must-do: ${must.title}.`,
    note: place?.note?.trim() || undefined,
    source: place ? 'curated' : 'must-do',
    recommendedBy: place ? peopleForPlace(place) : addedByYou(),
    booking: must.booking ?? place?.booking,
    bookingNote: must.bookingNote ?? place?.booking_note,
    bookingUrl: must.bookingUrl ?? place?.booking_url,
    startHint: request.pinned ? request.ideal : request.ideal,
    duration: must.duration || request.duration,
  };
}

function fromPlace(place: Place, request: Request, hoodOf: Map<string, string | null>, start: number, duration: number): Chosen {
  return {
    ...request,
    ideal: start,
    duration,
    title: place.name,
    place,
    lat: place.lat,
    lng: place.lng,
    neighborhood: place.neighborhood,
    hoodId: hoodOf.get(place.id) ?? null,
    description: place.description,
    note: place.note?.trim() || undefined,
    source: 'curated',
    recommendedBy: peopleForPlace(place),
    booking: place.booking,
    bookingNote: place.booking_note,
    bookingUrl: place.booking_url,
    startHint: start,
  };
}

function pickPlace(
  request: Request,
  places: Place[],
  hoodOf: Map<string, string | null>,
  cluster: Cluster,
  used: Set<string>,
  weekday: number,
  pace: Pace,
  vibes: string[],
  focusBias: boolean,
  prev?: { lat: number; lng: number }
): { place: Place; start: number; duration: number } | null {
  const categories = categoriesFor(request.role);
  const pool = places.filter((place) => {
    if (used.has(place.id)) return false;
    const hood = hoodOf.get(place.id);
    if (!hood || !cluster.hoods.includes(hood)) return false;
    if (request.role === 'activity') return !isFoodPlace(place) && hasCategory(place, categories);
    return hasCategory(place, categories);
  });
  const viable: { place: Place; start: number; duration: number; score: number; travel: number; primary: boolean }[] = [];
  for (const place of pool) {
    const duration = request.must?.duration || dwell(place, request.role, pace);
    const opening = findTimedStart(
      place,
      weekday,
      request.windowStart,
      Math.max(request.windowStart, request.windowEnd),
      request.ideal,
      duration,
      request.role !== 'show'
    );
    if (!opening) continue;
    const travel = prev ? estimateLeg(prev, place).minutes : 0;
    const primary = focusBias && hoodOf.get(place.id) === cluster.primary;
    let score = vibeScore(place, vibes) * 3 - (primary ? Math.min(travel, 20) * 0.4 : travel * 1.1);
    score -= Math.abs(opening.start - request.ideal) / 20;
    if (primary) score += 80;
    if (
      request.role === 'lunch' &&
      place.categories.includes('quick-bite') &&
      !place.categories.some((category) => category === 'lunch' || category === 'brunch')
    ) {
      score -= 12;
    }
    viable.push({ place, start: opening.start, duration: opening.duration, score, travel, primary });
  }
  const nearby = viable.filter((item) => item.travel <= 22 || item.primary);
  const ranked = (nearby.length ? nearby : viable).sort(
    (a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name)
  );
  return ranked[0] ?? null;
}

function buildRequests(input: PlanInput, musts: ParsedMust[], pace: Pace, warnings: string[]): Request[] {
  const shape = PACE_SHAPE[pace];
  const lunchMust = take(musts, (must) => must.slot === 'lunch');
  const dinnerMust = take(musts, (must) => must.slot === 'dinner');
  const breakfastMust = take(musts, (must) => must.slot === 'breakfast');
  const drinksMust = take(musts, (must) => must.slot === 'drinks');
  const rest = musts.filter((must) => !must.claimed);

  let lunchStart = lunchMust?.pinnedStart ?? 12 * 60 + 30;
  if (lunchMust?.pinnedStart == null) lunchStart = clamp(lunchStart, 12 * 60, 14 * 60);
  else if (lunchStart < 12 * 60 || lunchStart > 14 * 60) {
    warnings.push(`Lunch at ${formatMinutes(lunchStart)} is outside the usual 12:00–2:00 PM window. The time was kept.`);
  }
  const lunchDuration = lunchMust?.duration ?? dwell(null, 'lunch', pace);

  let dinnerStart = dinnerMust?.pinnedStart ?? 19 * 60;
  let dinnerDuration = dinnerMust?.duration ?? dwell(null, 'dinner', pace);
  const eveningShows = rest.filter(
    (must) => must.pinnedStart != null && (must.slot === 'show' || must.category === 'show') && must.pinnedStart >= 17 * 60
  );
  if (dinnerMust?.pinnedStart == null) {
    for (const show of eveningShows) {
      const latestEnd = show.pinnedStart! - 20;
      if (dinnerStart + Math.min(dinnerDuration, 75) > latestEnd) {
        dinnerDuration = Math.min(dinnerDuration, 75);
        dinnerStart = latestEnd - dinnerDuration;
      }
    }
  } else if (dinnerMust) {
    for (const show of eveningShows) {
      if (
        show.pinnedStart != null &&
        dinnerStart < show.pinnedStart + show.duration &&
        show.pinnedStart < dinnerStart + dinnerDuration
      ) {
        warnings.push(
          `${dinnerMust.title} (${formatMinutes(dinnerStart)}) overlaps ${show.title} (${formatMinutes(show.pinnedStart)}). Both times were kept.`
        );
      }
    }
  }

  let breakfastStart = breakfastMust?.pinnedStart ?? (isWeekend(input.date) ? 9 * 60 + 30 : 9 * 60);
  if (breakfastMust?.pinnedStart == null) breakfastStart = clamp(breakfastStart, 8 * 60 + 30, 10 * 60 + 30);
  const breakfastDuration = breakfastMust?.duration ?? dwell(null, 'breakfast', pace);

  const morningMusts = rest.filter((must) => {
    if (must.pinnedStart != null) return must.pinnedStart < 12 * 60;
    return must.daypart === 'morning';
  });
  const afternoonMusts = rest.filter((must) => {
    if (morningMusts.includes(must)) return false;
    if ((must.slot === 'show' || must.category === 'show') && (must.pinnedStart == null || must.pinnedStart >= dinnerStart - 30)) {
      return false;
    }
    if (must.pinnedStart != null) return must.pinnedStart >= 12 * 60 && must.pinnedStart < dinnerStart - 15;
    return must.daypart === 'afternoon' || must.daypart == null;
  });
  const showMusts = rest.filter((must) => !morningMusts.includes(must) && !afternoonMusts.includes(must));

  const requests: Request[] = [];
  const pushMust = (must: ParsedMust | null, role: SlotRole, ideal: number, windowStart: number, windowEnd: number, duration: number) => {
    requests.push({
      role,
      must,
      ideal,
      windowStart,
      windowEnd,
      duration,
      pinned: must?.pinnedStart != null,
    });
  };

  pushMust(breakfastMust, 'breakfast', breakfastStart, 8 * 60 + 30, 10 * 60 + 30, breakfastDuration);
  pushActivityWindow(requests, morningMusts, shape.morning, breakfastStart + breakfastDuration + 10, lunchStart - 15, pace);
  pushMust(lunchMust, 'lunch', lunchStart, 12 * 60, 14 * 60, lunchDuration);
  pushActivityWindow(
    requests,
    afternoonMusts,
    shape.afternoon,
    lunchStart + lunchDuration + 10,
    Math.max(lunchStart + lunchDuration + 40, dinnerStart - 20),
    pace
  );
  const pretheaterDinner = dinnerMust?.pinnedStart == null && dinnerStart < 18 * 60 + 30;
  pushMust(
    dinnerMust,
    'dinner',
    dinnerStart,
    pretheaterDinner ? Math.max(16 * 60 + 30, dinnerStart - 15) : dinnerMust?.pinnedStart != null ? dinnerStart : 18 * 60 + 30,
    pretheaterDinner ? dinnerStart + 20 : dinnerMust?.pinnedStart != null ? dinnerStart : 20 * 60 + 30,
    dinnerDuration
  );

  let latestEnd = dinnerStart + dinnerDuration;
  for (const must of showMusts) {
    const ideal = must.pinnedStart ?? Math.max(latestEnd + 20, 19 * 60);
    requests.push({
      role: 'show',
      must,
      ideal,
      windowStart: must.pinnedStart ?? ideal,
      windowEnd: must.pinnedStart ?? Math.min(22 * 60, ideal + 30),
      duration: must.duration,
      pinned: must.pinnedStart != null,
    });
    latestEnd = Math.max(latestEnd, ideal + must.duration);
  }

  if (drinksMust || shape.drinks) {
    const ideal = drinksMust?.pinnedStart ?? latestEnd + 15;
    if (drinksMust || ideal <= 22 * 60 + 15) {
      requests.push({
        role: 'drinks',
        must: drinksMust,
        ideal,
        windowStart: drinksMust?.pinnedStart ?? ideal,
        windowEnd: 22 * 60 + 30,
        duration: drinksMust?.duration ?? dwell(null, 'drinks', pace),
        pinned: drinksMust?.pinnedStart != null,
      });
    }
  }

  return requests.sort((a, b) => a.ideal - b.ideal || ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

function take(musts: ParsedMust[], predicate: (must: ParsedMust) => boolean): ParsedMust | null {
  const found = musts.find((must) => !must.claimed && predicate(must));
  if (found) found.claimed = true;
  return found ?? null;
}

function pushActivityWindow(
  requests: Request[],
  musts: ParsedMust[],
  flexCount: number,
  windowStart: number,
  windowEnd: number,
  pace: Pace
) {
  const span = windowEnd - windowStart;
  for (const must of musts) {
    requests.push({
      role: must.slot === 'show' ? 'show' : 'activity',
      must,
      ideal: must.pinnedStart ?? clamp(windowStart + 20, windowStart, Math.max(windowStart, windowEnd - 30)),
      windowStart: must.pinnedStart ?? windowStart,
      windowEnd: must.pinnedStart ?? Math.max(windowStart, windowEnd),
      duration: must.duration,
      pinned: must.pinnedStart != null,
    });
  }
  const loose = musts.filter((must) => must.pinnedStart == null).length;
  const flex = Math.max(0, flexCount - loose);
  if (flex === 0 || span < 40) return;
  for (let index = 0; index < flex; index += 1) {
    const ideal = windowStart + ((index + 1) * span) / (flex + 1);
    requests.push({
      role: 'activity',
      must: null,
      ideal,
      windowStart,
      windowEnd,
      duration: dwell(null, 'activity', pace),
      pinned: false,
    });
  }
}

function realize(
  chosen: Chosen[],
  weekday: number,
  warnings: string[],
  origin?: { lat: number; lng: number; label?: string } | null
): ItineraryVisit[] {
  const visits: ItineraryVisit[] = [];
  for (let index = 0; index < chosen.length; index += 1) {
    const item = chosen[index];
    const prev = visits[visits.length - 1];
    let leg = prev ? legBetween(prev, item) : null;
    if (!prev && origin && item.lat != null && item.lng != null) {
      const fromYou = estimateLeg(
        { lat: origin.lat, lng: origin.lng, label: origin.label || 'Your location' },
        { lat: item.lat, lng: item.lng, label: item.title }
      );
      leg = { ...fromYou, summary: `From your location · ${fromYou.summary}` };
    }
    const travel = leg?.minutes ?? 0;
    const arrival = prev ? prev.endMin + travel : item.startHint;
    let start = item.pinned || isMeal(item.role) ? Math.max(item.pinned ? item.startHint : item.startHint, item.pinned ? item.startHint : arrival) : Math.max(arrival, item.windowStart);
    if (item.pinned) start = item.startHint;
    else if (isMeal(item.role)) start = Math.max(arrival, item.startHint);
    else start = Math.max(arrival, item.windowStart);

    let duration = item.duration;
    if (!item.pinned) {
      const nextAnchor = chosen.slice(index + 1).find((next) => next.pinned || isMeal(next.role) || next.role === 'show');
      if (nextAnchor) {
        const toNext =
          item.lat != null && nextAnchor.lat != null
            ? estimateLeg(
                { lat: item.lat, lng: item.lng!, label: item.title },
                { lat: nextAnchor.lat, lng: nextAnchor.lng!, label: nextAnchor.title }
              ).minutes
            : 15;
        const latestEnd = nextAnchor.startHint - toNext;
        if (start + duration > latestEnd) duration = latestEnd - start;
      }
      if (start + duration > 23 * 60) duration = 23 * 60 - start;
      if (duration < 20) continue;
    }

    if (!prev && leg && leg.minutes > 45) {
      warnings.push(
        `You're about ${leg.minutes} minutes from ${item.title}. The day still starts at ${formatMinutes(item.pinned ? item.startHint : start)}.`
      );
    }

    if (item.pinned && prev && arrival > item.startHint + 10) {
      warnings.push(
        `The trip to ${item.title} gets in about ${arrival - item.startHint} min after ${formatMinutes(item.startHint)}. The time was kept.`
      );
    }

    if (item.place && !visitFitsHours(item.place, weekday, start, Math.max(duration, 30))) {
      if (item.pinned) {
        warnings.push(
          `${item.title} isn't open for the full visit at ${formatMinutes(start)}. The time you set was kept.`
        );
      } else {
        const earliest = isMeal(item.role) ? Math.max(start, item.startHint, item.windowStart) : Math.max(start, item.windowStart);
        const opening = findTimedStart(
          item.place,
          weekday,
          earliest,
          Math.max(earliest, item.windowEnd),
          earliest,
          Math.max(duration, 30),
          true
        );
        if (!opening) {
          warnings.push(`Skipped ${item.title} because the visit would fall outside opening hours.`);
          continue;
        }
        start = opening.start;
        duration = opening.duration;
      }
    }

    if (!item.pinned && isMeal(item.role)) {
      const window =
        item.role === 'lunch'
          ? [12 * 60, 14 * 60]
          : item.role === 'dinner'
            ? [18 * 60 + 30, 20 * 60 + 30]
            : [8 * 60 + 30, 10 * 60 + 30];
      const pretheater = item.role === 'dinner' && item.startHint < 18 * 60 + 30;
      if (!pretheater && (start < window[0] || start > window[1])) {
        warnings.push(
          `${item.title} starts at ${formatMinutes(start)}, outside the usual ${item.role} window. It was not moved earlier.`
        );
      }
    }

    visits.push({
      role: item.role,
      title: item.title,
      startMin: start,
      endMin: start + duration,
      neighborhood: item.neighborhood,
      description: item.description,
      note: item.note,
      lat: item.lat,
      lng: item.lng,
      placeId: item.place?.id,
      hoodId: item.hoodId,
      source: item.source,
      mustDo: Boolean(item.must),
      pinned: item.pinned,
      recommendedBy: item.recommendedBy,
      booking: item.booking,
      bookingNote: item.bookingNote,
      bookingUrl: item.bookingUrl,
      leg,
    });
  }
  return visits;
}

function legBetween(prev: ItineraryVisit, next: { lat?: number; lng?: number; title: string; neighborhood: string }): Leg {
  if (prev.lat != null && prev.lng != null && next.lat != null && next.lng != null) {
    return estimateLeg(
      { lat: prev.lat, lng: prev.lng, label: prev.title },
      { lat: next.lat, lng: next.lng, label: next.title }
    );
  }
  return {
    mode: 'transit',
    minutes: 15,
    summary: '15 min by subway/bus (estimated)',
    lines: [],
    mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${prev.title}, ${prev.neighborhood}`)}&destination=${encodeURIComponent(`${next.title}, ${next.neighborhood}, New York`)}&travelmode=transit`,
    source: 'estimate',
  };
}

function insertFree(visits: ItineraryVisit[]): ItineraryVisit[] {
  const withFree: ItineraryVisit[] = [];
  for (const visit of visits) {
    const prev = withFree[withFree.length - 1];
    if (prev) {
      const travel = visit.leg?.minutes ?? 0;
      const gapEnd = visit.startMin - travel;
      if (gapEnd - prev.endMin >= 25) {
        withFree.push({
          role: 'free',
          title: 'Free time',
          startMin: prev.endMin,
          endMin: gapEnd,
          neighborhood: prev.neighborhood,
          description: `Unscheduled time in ${prev.neighborhood}. Stay longer or wander. The next meal stays put.`,
          source: 'free',
          pinned: false,
          recommendedBy: [],
          leg: null,
          lat: prev.lat,
          lng: prev.lng,
          hoodId: prev.hoodId,
        });
      }
    }
    withFree.push(visit);
  }
  return withFree;
}

function renderStops(visits: ItineraryVisit[]): RenderedStop[] {
  const stops: RenderedStop[] = [];
  for (const visit of visits) {
    if (visit.leg) {
      stops.push({
        time: '',
        title: 'Transit',
        location: '',
        description: visit.leg.summary,
        url: visit.leg.mapsUrl,
        mapsUrl: visit.leg.mapsUrl,
        kind: 'transit',
        leg: visit.leg,
      });
    }
    const placeStop: RenderedStop = {
      time: formatRange(visit.startMin, visit.endMin),
      title: visit.title,
      location: visit.neighborhood,
      description: visit.description,
      url:
        visit.role === 'free'
          ? undefined
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${visit.title} ${visit.neighborhood} New York`)}`,
      kind: visit.role === 'free' ? 'free' : 'place',
      role: visit.role,
      placeId: visit.placeId,
      lat: visit.lat,
      lng: visit.lng,
      startMin: visit.startMin,
      endMin: visit.endMin,
      pinned: visit.pinned,
      source: visit.source,
      mustDo: visit.mustDo,
      hoodId: visit.hoodId,
      recommendedBy: visit.recommendedBy,
      note: visit.note,
      booking: visit.booking,
      bookingNote: visit.bookingNote,
      bookingUrl: visit.bookingUrl,
      warning: visit.warning,
      mapsUrl: visit.leg?.mapsUrl,
      leg: visit.leg,
    };
    stops.push(placeStop);
  }
  return stops;
}

function bookAheadFor(visits: ItineraryVisit[]): BookAheadItem[] {
  return visits
    .filter((visit) => visit.booking && BOOK_AHEAD_KINDS.has(visit.booking))
    .map((visit) => ({
      title: visit.title,
      time: formatRange(visit.startMin, visit.endMin),
      booking: visit.booking!,
      bookingLabel: BOOKING_LABEL[visit.booking!],
      bookingNote: visit.bookingNote,
      bookingUrl: visit.bookingUrl,
    }));
}

function finalize(
  input: PlanInput,
  pace: Pace,
  vibes: string[],
  cluster: Cluster,
  visits: ItineraryVisit[],
  warnings: string[],
  startLocation?: PlanInput['startLocation']
): Itinerary {
  const withFree = insertFree(visits);
  const routeStops = withFree.filter((visit) => visit.role !== 'free' && visit.lat != null);
  const mapPoints = [
    ...(startLocation ? [{ lat: startLocation.lat, lng: startLocation.lng, label: startLocation.label || 'Your location' }] : []),
    ...routeStops.map((visit) => ({ lat: visit.lat, lng: visit.lng, label: visit.title })),
  ];
  const transitLegs = withFree.filter((visit) => visit.leg?.mode === 'transit').length;
  const walkLegs = withFree.filter((visit) => visit.leg?.mode === 'walk').length;
  return {
    date: input.date,
    pace,
    vibes,
    cluster,
    visits: withFree,
    stops: renderStops(withFree),
    warnings,
    mapsUrl: dayMapsUrl(mapPoints, transitLegs > walkLegs ? 'transit' : 'walking'),
    startLocation: startLocation ?? null,
    bookAhead: bookAheadFor(withFree),
  };
}

function schedule(input: PlanInput, places: Place[]): Itinerary {
  const pace: Pace = input.pace ?? 'balanced';
  const vibes = (input.vibes ?? []).map((vibe) => vibe.toLowerCase());
  const warnings: string[] = [];
  const weekday = weekdayIndex(input.date);
  const hoodOf = new Map(places.map((place) => [place.id, hoodForPlace(place)]));
  const musts = parseMustDos(input.locks, places, pace);
  const focus = focusHoodId(input.focusArea);
  const cluster = chooseCluster(focus, musts, places, hoodOf, weekday, pace, vibes, input.date);
  const requests = buildRequests(input, musts, pace, warnings);
  const used = new Set<string>();
  for (const request of requests) {
    if (request.must?.place) used.add(request.must.place.id);
  }
  const chosen: Chosen[] = [];
  let prevPoint: { lat: number; lng: number } | undefined;

  for (const request of requests) {
    if (request.must) {
      const chosenMust = fromMust(request.must, request, hoodOf);
      if (chosenMust.place) used.add(chosenMust.place.id);
      chosen.push(chosenMust);
      if (chosenMust.lat != null && chosenMust.lng != null) prevPoint = { lat: chosenMust.lat, lng: chosenMust.lng };
      continue;
    }
    const picked = pickPlace(request, places, hoodOf, cluster, used, weekday, pace, vibes, Boolean(focus), prevPoint);
    if (!picked) {
      if (isMeal(request.role)) warnings.push(`No open ${request.role} spot fit in ${cluster.label}.`);
      continue;
    }
    used.add(picked.place.id);
    const next = fromPlace(picked.place, request, hoodOf, picked.start, picked.duration);
    chosen.push(next);
    prevPoint = { lat: picked.place.lat, lng: picked.place.lng };
  }

  const visits = realize(chosen, weekday, warnings, input.startLocation);
  const pinnedShow = visits.find((visit) => visit.role === 'show' && visit.pinned);
  const dinnerVisit = visits.find((visit) => visit.role === 'dinner' && !visit.pinned);
  if (pinnedShow && dinnerVisit && dinnerVisit.startMin < 18 * 60 + 30) {
    warnings.push(
      `Dinner is at ${formatMinutes(dinnerVisit.startMin)} so ${pinnedShow.title} stays at ${formatMinutes(pinnedShow.startMin)}.`
    );
  }
  return finalize(input, pace, vibes, cluster, visits, warnings, input.startLocation);
}

export function summarizeItinerary(itinerary: Itinerary): string {
  const lines = itinerary.visits.map((visit) => {
    const leg = visit.leg ? ` | ${visit.leg.summary}` : '';
    return `${formatRange(visit.startMin, visit.endMin)}  ${visit.role.padEnd(10)}  ${visit.title} (${visit.neighborhood})${leg}`;
  });
  if (itinerary.warnings.length) lines.push(`warnings: ${itinerary.warnings.join(' | ')}`);
  lines.push(`cluster: ${itinerary.cluster.label}`);
  lines.push(`maps: ${itinerary.mapsUrl}`);
  return lines.join('\n');
}

async function applyGoogle(itinerary: Itinerary): Promise<Itinerary> {
  const weekday = weekdayIndex(itinerary.date);
  const warnings = [...itinerary.warnings];
  const visits = itinerary.visits
    .filter((visit) => visit.role !== 'free')
    .map((visit) => ({ ...visit, leg: visit.leg ? { ...visit.leg } : null }));
  for (let index = 1; index < visits.length; index += 1) {
    const prev = visits[index - 1];
    const current = visits[index];
    if (prev.lat == null || current.lat == null || prev.lng == null || current.lng == null) continue;
    current.leg = await routeLeg(
      { lat: prev.lat, lng: prev.lng, label: prev.title },
      { lat: current.lat, lng: current.lng, label: current.title }
    );
    const arrival = prev.endMin + current.leg.minutes;
    if (current.pinned) {
      if (arrival > current.startMin + 10) {
        warnings.push(
          `With live traffic, ${current.title} is about ${arrival - current.startMin} min after ${formatMinutes(current.startMin)}. The time was kept.`
        );
      }
      continue;
    }
    const nextStart = isMeal(current.role as SlotRole) ? Math.max(current.startMin, arrival) : Math.max(current.startMin, arrival);
    const shift = nextStart - current.startMin;
    if (shift > 0) {
      current.startMin += shift;
      current.endMin += shift;
      if (current.placeId) {
        const place = getPlaces().find((item) => item.id === current.placeId);
        if (place && !visitFitsHours(place, weekday, current.startMin, current.endMin - current.startMin)) {
          warnings.push(`${current.title} no longer fits its opening hours after travel was updated.`);
        }
      }
    }
  }
  return finalize(
    { date: itinerary.date, pace: itinerary.pace, vibes: itinerary.vibes, startLocation: itinerary.startLocation },
    itinerary.pace,
    itinerary.vibes,
    itinerary.cluster,
    visits,
    warnings,
    itinerary.startLocation
  );
}

export async function planDay(input: PlanInput, dataset?: Place[]): Promise<Itinerary> {
  const places = dataset ?? getPlaces();
  let itinerary = schedule(input, places);
  if (process.env.XAI_SUGGESTIONS === 'true' && xaiEnabled()) {
    itinerary = await fillAiGaps(itinerary, input, places);
  }
  if (process.env.GOOGLE_MAPS_API_KEY) itinerary = await applyGoogle(itinerary);
  if (process.env.XAI_POLISH === 'true') itinerary = await polishItinerary(itinerary, input);
  return itinerary;
}

/** @deprecated Use planDay. Returns rendered stops for older call sites. */
export async function buildItinerary(input: PlanInput, dataset?: Place[]): Promise<RenderedStop[]> {
  const itinerary = await planDay(input, dataset);
  return itinerary.stops;
}

export const plan = planDay;

async function fillAiGaps(itinerary: Itinerary, input: PlanInput, places: Place[]): Promise<Itinerary> {
  const missingMeal = (['breakfast', 'lunch', 'dinner'] as const).find(
    (role) => !itinerary.visits.some((visit) => visit.role === role)
  );
  if (!missingMeal) return itinerary;
  const text = await grokComplete(
    [
      {
        role: 'system',
        content:
          'Suggest one real NYC place. Return JSON only: {"name":"","neighborhood":"","description":"","lat":0,"lng":0}. This is an AI suggestion, not a trusted local pick.',
      },
      {
        role: 'user',
        content: `Need one ${missingMeal} in ${itinerary.cluster.label}. Avoid: ${places
          .slice(0, 30)
          .map((place) => place.name)
          .join(', ')}`,
      },
    ],
    { temperature: 0.3, timeoutMs: 8000 }
  );
  if (!text) return itinerary;
  try {
    const parsed = parseJsonObject(text) as { name?: string; neighborhood?: string; description?: string; lat?: number; lng?: number };
    if (!parsed?.name) return itinerary;
    const visit: ItineraryVisit = {
      role: missingMeal,
      title: parsed.name,
      startMin: missingMeal === 'lunch' ? 12 * 60 + 30 : missingMeal === 'dinner' ? 19 * 60 : 9 * 60,
      endMin: missingMeal === 'lunch' ? 13 * 60 + 45 : missingMeal === 'dinner' ? 20 * 60 + 30 : 9 * 60 + 45,
      neighborhood: parsed.neighborhood || itinerary.cluster.label,
      description: parsed.description || 'AI suggestion.',
      lat: parsed.lat,
      lng: parsed.lng,
      source: 'ai',
      pinned: false,
      recommendedBy: recommendedByAi(),
      booking: 'unknown',
      leg: null,
    };
    const warnings = [...itinerary.warnings, `${parsed.name} is an AI suggestion, not from the trusted list.`];
    const visits = [...itinerary.visits.filter((item) => item.role !== 'free'), visit].sort((a, b) => a.startMin - b.startMin);
    return finalize({ ...input, pace: itinerary.pace, vibes: itinerary.vibes }, itinerary.pace, itinerary.vibes, itinerary.cluster, visits, warnings);
  } catch {
    return itinerary;
  }
}

async function polishItinerary(itinerary: Itinerary, input: PlanInput): Promise<Itinerary> {
  const text = await grokComplete(
    [
      {
        role: 'system',
        content:
          'Rewrite descriptions only. Return JSON {"descriptions": string[]} with the same length and order. Do not change titles or times.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          city: input.city ?? 'New York City',
          descriptions: itinerary.visits.filter((visit) => visit.role !== 'free').map((visit) => visit.description),
        }),
      },
    ],
    { timeoutMs: 8000 }
  );
  if (!text) return itinerary;
  try {
    const parsed = parseJsonObject(text) as { descriptions?: string[] };
    const descriptions = parsed.descriptions;
    const targets = itinerary.visits.filter((visit) => visit.role !== 'free');
    if (!descriptions || descriptions.length !== targets.length) return itinerary;
    let cursor = 0;
    const visits = itinerary.visits.map((visit) => {
      if (visit.role === 'free') return visit;
      const description = descriptions[cursor];
      cursor += 1;
      return description?.trim() ? { ...visit, description: description.trim() } : visit;
    });
    return { ...itinerary, visits, stops: renderStops(visits) };
  } catch {
    return itinerary;
  }
}

export async function replanItinerary(input: {
  date: string;
  pace?: Pace;
  vibes?: string[];
  focusArea?: string | null;
  mood: string;
  replaceIndex: number;
  stops: RenderedStop[];
  city?: string;
}): Promise<Itinerary> {
  const pace = input.pace ?? 'balanced';
  const vibes = input.vibes ?? [];
  const places = getPlaces();
  const hoodOf = new Map(places.map((place) => [place.id, hoodForPlace(place)]));
  const weekday = weekdayIndex(input.date);
  const visible = input.stops.filter((stop) => stop.kind !== 'transit' && stop.title !== 'Transit');
  const target = visible[input.replaceIndex];
  if (!target || target.kind === 'free' || target.role === 'free') {
    return planDay({
      date: input.date,
      pace,
      vibes,
      focusArea: input.focusArea,
      city: input.city,
    });
  }
  const mood = input.mood.toLowerCase();
  const used = new Set(visible.map((stop) => stop.placeId).filter((id): id is string => Boolean(id)));
  const start = target.startMin ?? 12 * 60;
  const duration = target.endMin && target.startMin ? target.endMin - target.startMin : 60;
  const role = (target.role ?? 'activity') as SlotRole;
  let categories = categoriesFor(role);
  if (mood.includes('hungry')) categories = ['lunch', 'quick-bite', 'dinner', 'bakery', 'coffee'];
  if (mood.includes('tired')) categories = ['coffee', 'gallery', 'museum', 'cafe'];
  const focus = focusHoodId(input.focusArea);
  const clusterHoods = focus ? [focus, ...(hoodById(focus)?.adjacent ?? [])] : null;

  let best: { place: Place; score: number } | null = null;
  for (const place of places) {
    if (used.has(place.id)) continue;
    const hood = hoodOf.get(place.id);
    if (clusterHoods && (!hood || !clusterHoods.includes(hood))) continue;
    if (mood.includes('hungry')) {
      if (!hasCategory(place, categories) && !isFoodPlace(place)) continue;
    } else if (role === 'activity' && isFoodPlace(place)) continue;
    else if (!hasCategory(place, categories) && !mood.includes('hungry')) continue;
    if ((mood.includes('weather') || mood.includes('rain')) && (place.outdoor || place.categories.includes('park'))) continue;
    if (!visitFitsHours(place, weekday, start, Math.min(duration, place.duration_max || duration))) continue;
    const prev = visible[input.replaceIndex - 1];
    const travel =
      prev?.lat != null && prev.lng != null ? estimateLeg({ lat: prev.lat, lng: prev.lng }, place).minutes : 0;
    let score = (mood.includes('different') ? -1 : 1) * vibeScore(place, vibes) * 3 - travel * 0.3;
    if (focus && hood === focus) score += 10;
    if (!best || score > best.score || (score === best.score && place.name.localeCompare(best.place.name) < 0)) {
      best = { place, score };
    }
  }

  const warnings = [
    best
      ? `Swapped in ${best.place.name} for “${input.mood}”.`
      : `Kept ${target.title}. Nothing nearby was open for that time.`,
  ];
  const replacement = best?.place;
  const chosen: Chosen[] = [];
  for (const stop of visible) {
    if (stop.kind === 'free' || stop.role === 'free') continue;
    const original = stop === target && replacement
      ? places.find((place) => place.id === replacement.id) ?? null
      : places.find((place) => place.id === stop.placeId) ?? null;
    const place = stop === target && replacement ? replacement : original;
    const stopRole = (stop.role ?? 'activity') as SlotRole;
    const scheduled = stop.endMin && stop.startMin ? stop.endMin - stop.startMin : undefined;
    const keptDuration =
      stop === target
        ? place
          ? dwell(place, stopRole, pace)
          : scheduled ?? duration
        : scheduled ?? (place ? dwell(place, stopRole, pace) : duration);
    chosen.push({
      role: stop === target && mood.includes('hungry') && stopRole === 'activity' ? 'lunch' : stopRole,
      must: stop !== target && stop.mustDo ? ({ title: stop.title } as Chosen['must']) : null,
      ideal: stop.startMin ?? start,
      windowStart: stop.startMin ?? start,
      windowEnd: stop.startMin ?? start,
      duration: keptDuration,
      pinned: Boolean(stop.pinned),
      title: place?.name ?? stop.title,
      place,
      lat: place?.lat ?? stop.lat,
      lng: place?.lng ?? stop.lng,
      neighborhood: place?.neighborhood ?? stop.location,
      hoodId: place ? hoodOf.get(place.id) ?? null : stop.hoodId ?? null,
      description: place?.description ?? stop.description,
      note: place?.note,
      source: place ? 'curated' : stop.source ?? 'must-do',
      recommendedBy: place ? peopleForPlace(place) : stop.recommendedBy ?? addedByYou(),
      booking: place?.booking ?? stop.booking,
      bookingNote: place?.booking_note ?? stop.bookingNote,
      bookingUrl: place?.booking_url ?? stop.bookingUrl,
      startHint: stop.startMin ?? start,
    });
  }
  const visits = realize(chosen, weekday, warnings);
  const focusCluster: Cluster = {
    primary: focus ?? chosen.find((item) => item.hoodId)?.hoodId ?? 'west-village',
    hoods: clusterHoods ?? Array.from(new Set(chosen.map((item) => item.hoodId).filter((id): id is string => Boolean(id)))),
    label: input.focusArea || 'this day',
  };
  return finalize({ date: input.date, pace, vibes, city: input.city }, pace, vibes, focusCluster, visits, warnings);
}
