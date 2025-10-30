import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { formatTimelineWithLLM } from '@/lib/llm';
import { travelMinutesBetween } from '@/lib/geo';
import { getFocusAreaKeys, normalizeAreaValue } from '@/lib/areas';
import { getPlacesDataset } from '@/lib/places-dataset';
import { areaKeyFromString } from '@/lib/planner';

const BodySchema = z.object({
  city: z.string(),
  date: z.string(), // YYYY-MM-DD
  nowTime: z.string().optional(),
  nowLoc: z.object({ lat: z.number(), lon: z.number() }).optional(),
  mood: z.string(), // e.g., "I'm Hungry", "Weather Changed", "Less Walking"
  pace: z.enum(['chill', 'balanced', 'max']).optional(),
  vibes: z.array(z.string()).optional(),
  focusArea: z.string().optional().nullable(),
  replaceIndex: z.number().int().nonnegative().optional(),
  currentStops: z.array(z.object({
    time: z.string(),       // may be "HH:MM" or "HH:MM – HH:MM"
    title: z.string(),
    location: z.string(),
    description: z.string().optional()
  }))
});

type Place = {
  name: string;
  category?: string;
  neighborhood?: string;
  duration_min?: number;
  vibe_tags?: string[];
  energy_tags?: string[];
  description?: string;
  location: string;
};

const MAX_NON_ANCHOR_TRAVEL_MIN = 60;

// ---------- Duration Heuristics (match generate-itinerary) ----------
const MIN_BY_CATEGORY: Record<string, number> = {
  museum: 90,
  gallery: 60,
  landmark: 60,
  restaurant: 60,
  food: 60,
  coffee: 30,
  cafe: 45,
  park: 45,
  outdoors: 60,
  shopping: 45,
  culture: 60,
  nightlife: 90,
};
function minFor(category?: string, pace: 'chill'|'balanced'|'max' = 'balanced') {
  const key = (category || '').toLowerCase();
  const base = MIN_BY_CATEGORY[key] ?? 45;
  if (pace === 'chill') return Math.round(base * 1.2);
  if (pace === 'max')   return Math.round(base * 0.85);
  return base;
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function parseStart(time: string, date: string) {
  // Accept "HH:MM" or "HH:MM – HH:MM"; fall back to 09:00
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  const h = m ? parseInt(m[1], 10) : 9;
  const min = m ? parseInt(m[2], 10) : 0;
  const d = new Date(`${date}T09:00:00`);
  d.setHours(h, min, 0, 0);
  return d;
}

export async function POST(req: NextRequest) {
  const json = await req.json();
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const {
    city,
    date,
    mood,
    currentStops,
    pace = 'balanced',
    vibes = [],
    focusArea,
    replaceIndex,
  } = parsed.data;

  if (currentStops.length === 0) {
    return NextResponse.json({ error: 'No stops to adjust' }, { status: 400 });
  }

  const all = getPlacesDataset() as Place[];
  const vibeSet = new Set(vibes.map(v => v.toLowerCase()));
  const normalizedFocus = normalizeAreaValue(focusArea);
  const focusAreaKeys = getFocusAreaKeys(normalizedFocus);
  const focusAreaSet = new Set(focusAreaKeys);
  const focusEnabled = focusAreaSet.size > 0;
  const primaryFocusArea = focusAreaKeys[0] ?? null;

  // 1) Enrich current stops with seed matches (to recover categories/durations)
  const enriched = currentStops.map(s => {
    const match = all.find(p => p.name.toLowerCase() === s.title.toLowerCase());
    return {
      ...s,
      description: s.description ?? '',
      _category: match?.category,
      _seedDur: typeof match?.duration_min === 'number' ? match?.duration_min : undefined,
      _seedLoc: match?.location || match?.neighborhood || city
    };
  });

  // 2) Choose which stop to replace (default to first if not supplied)
  const replaceIdx = Math.min(
    Math.max(replaceIndex ?? 0, 0),
    Math.max(enriched.length - 1, 0)
  );

  if (focusEnabled) {
    const targetSeed = (enriched[replaceIdx] as any)?._seedLoc || enriched[replaceIdx]?.location || '';
    const targetArea = areaKeyFromString(targetSeed);
    if (targetArea) focusAreaSet.add(targetArea);
  }

  // 3) Build mood-filtered candidate pool
  const m = mood.toLowerCase();
  let pool = all.slice();

  if (focusEnabled) {
    const focusFiltered = pool.filter(candidate => {
      const area = areaKeyFromString(candidate.neighborhood || candidate.location || '');
      return area ? focusAreaSet.has(area) : false;
    });
    if (focusFiltered.length) {
      pool = focusFiltered;
    }
  }

  if (vibes.length && !m.includes('different vibe')) {
    const aligned = pool.filter(p =>
      (p.vibe_tags || []).some(tag => vibeSet.has(tag.toLowerCase()))
    );
    if (aligned.length) pool = aligned;
  }
  if (m.includes('different vibe') && vibes.length) {
    const alt = pool.filter(p =>
      !(p.vibe_tags || []).some(tag => vibeSet.has(tag.toLowerCase()))
    );
    if (alt.length) pool = alt;
  }

  if (m.includes('hungry')) {
    const foodCats = new Set([
      'food', 'restaurant', 'coffee', 'cafe', 'lunch', 'dinner', 'breakfast', 'snack', 'market'
    ]);
    pool = pool.filter(p => {
      const c = (p.category || '').toLowerCase();
      return foodCats.has(c);
    });
  }
  if (m.includes('weather')) {
    // prefer indoors: exclude obvious outdoors
    const outdoorCats = new Set(['outdoors', 'park', 'walk', 'view']);
    pool = pool.filter(p => !outdoorCats.has((p.category || '').toLowerCase()));
  }
  if (m.includes('tired')) {
    const restful = pool.filter(p => {
      const c = (p.category || '').toLowerCase();
      return ['coffee', 'cafe', 'snack', 'museum', 'gallery', 'bar'].includes(c);
    });
    if (restful.length) pool = restful;
  }

  // Avoid suggesting the exact same as the one we’re replacing
  const currentTitle = enriched[replaceIdx]?.title;
  pool = pool.filter(p => p.name !== currentTitle);

  if (pool.length === 0) {
    pool = all.slice();
  }

  const locationFor = (stop: typeof enriched[number] | null): string | null => {
    if (!stop) return null;
    const seed = (stop as any)._seedLoc;
    if (typeof seed === 'string' && seed.trim()) return seed;
    if (stop.location && stop.location.trim()) return stop.location;
    return null;
  };

  const prevStop = replaceIdx > 0 ? enriched[replaceIdx - 1] : null;
  const nextStop = replaceIdx + 1 < enriched.length ? enriched[replaceIdx + 1] : null;
  const prevLoc = locationFor(prevStop);
  const nextLoc = locationFor(nextStop);

  const travelSafePool = pool.filter(candidate => {
    const candidateLoc = candidate.location || candidate.neighborhood || city;
    if (prevLoc) {
      const travelPrev = travelMinutesBetween(prevLoc, candidateLoc);
      if (travelPrev > MAX_NON_ANCHOR_TRAVEL_MIN) return false;
    }
    if (nextLoc) {
      const travelNext = travelMinutesBetween(candidateLoc, nextLoc);
      if (travelNext > MAX_NON_ANCHOR_TRAVEL_MIN) return false;
    }
    return true;
  });

  if (travelSafePool.length === 0) {
    return NextResponse.json({
      stops: currentStops,
      note: `Kept your original stop — nothing nearby fit “${mood}”.`,
    });
  }

  let selectionPool = travelSafePool;
  if (focusEnabled) {
    const focusCandidates = travelSafePool.filter(candidate => {
      const area = areaKeyFromString(candidate.neighborhood || candidate.location || '');
      return area ? focusAreaSet.has(area) : false;
    });
    if (focusCandidates.length) {
      selectionPool = focusCandidates;
    }
  }

  // Pick a replacement
  const replacement = selectionPool[Math.floor(Math.random() * selectionPool.length)];
  const replacementLocation = replacement.location || replacement.neighborhood || city;

  // 4) Splice replacement into the list
  const nextList = enriched.map((x, i) =>
    i === replaceIdx
      ? {
          time: x.time,
          title: replacement.name,
          location: replacementLocation,
          description: replacement.description || `Adjusted for ${mood}`,
          _category: replacement.category,
          _seedDur: typeof replacement.duration_min === 'number' ? replacement.duration_min : undefined,
          _seedLoc: replacementLocation
        }
      : x
  );

  // 5) Recompute schedule from 09:00 using durations + travel
  let current = new Date(`${date}T09:00:00`);
  const recomputed = nextList.map((p, idx) => {
    const seedDur = typeof (p as any)._seedDur === 'number' ? (p as any)._seedDur : undefined;
    const cat = (p as any)._category as string | undefined;
    const dur = Math.max(seedDur ?? 0, minFor(cat, pace));
    const start = new Date(current.getTime());
    const end   = new Date(start.getTime() + dur * 60_000);

    // travel to next
    const next = nextList[idx + 1];
    let travel = 0;
    if (next) {
      const fromLoc = (p as any)._seedLoc || p.location;
      const toLoc   = (next as any)._seedLoc || next.location;
      travel = travelMinutesBetween(fromLoc, toLoc);
    }
    current = new Date(end.getTime() + travel * 60_000);

    return {
      time: `${fmtTime(start)} – ${fmtTime(end)}`,
      title: p.title,
      location: p.location || city,
      description: p.description
    };
  });

  const polished = await formatTimelineWithLLM(recomputed, { city, vibes, pace });
  return NextResponse.json({ stops: polished, note: `Adjusted for mood: ${mood}` });
}
