import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import places from '@/data/nyc-places.json';
import { formatTimelineWithLLM } from '@/lib/llm';
import { travelMinutesBetween } from '@/lib/geo';

const BodySchema = z.object({
  city: z.string(),
  date: z.string(), // YYYY-MM-DD
  nowTime: z.string().optional(),
  nowLoc: z.object({ lat: z.number(), lon: z.number() }).optional(),
  mood: z.string(), // e.g., "I'm Hungry", "Weather Changed", "Less Walking"
  currentStops: z.array(z.object({
    time: z.string(),       // may be "HH:MM" or "HH:MM – HH:MM"
    title: z.string(),
    location: z.string(),
    description: z.string()
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

  const { city, date, mood, currentStops } = parsed.data;

  const all = places as Place[];

  // 1) Enrich current stops with seed matches (to recover categories/durations)
  const enriched = currentStops.map(s => {
    const match = all.find(p => p.name.toLowerCase() === s.title.toLowerCase());
    return {
      ...s,
      _category: match?.category,
      _seedDur: typeof match?.duration_min === 'number' ? match?.duration_min : undefined,
      _seedLoc: match?.location || match?.neighborhood || city
    };
  });

  // 2) Choose which stop to replace (keep it simple: the *next* stop, index 0)
  const replaceIdx = 0;

  // 3) Build mood-filtered candidate pool
  const m = mood.toLowerCase();
  let pool = all.slice();

  if (m.includes('hungry')) {
    pool = pool.filter(p => {
      const c = (p.category || '').toLowerCase();
      return c === 'food' || c === 'restaurant' || c === 'coffee' || c === 'cafe';
    });
  }
  if (m.includes('weather')) {
    // prefer indoors: exclude obvious outdoors
    pool = pool.filter(p => (p.category || '').toLowerCase() !== 'outdoors' && (p.category || '').toLowerCase() !== 'park');
  }
  if (m.includes('less walking') || m.includes('tired')) {
    // bias toward closer locations later when we compute schedule (we still keep pool broad)
    // (Heuristic is applied by travelMinutesBetween between consecutive stops)
  }

  // Avoid suggesting the exact same as the one we’re replacing
  const currentTitle = enriched[replaceIdx]?.title;
  pool = pool.filter(p => p.name !== currentTitle);

  // Pick a replacement
  const replacement = pool[Math.floor(Math.random() * pool.length)] || all[0];

  // 4) Splice replacement into the list
  const nextList = enriched.map((x, i) =>
    i === replaceIdx
      ? {
          time: x.time,
          title: replacement.name,
          location: replacement.location,
          description: replacement.description || 'Adjusted for your mood',
          _category: replacement.category,
          _seedDur: typeof replacement.duration_min === 'number' ? replacement.duration_min : undefined,
          _seedLoc: replacement.location || replacement.neighborhood || city
        }
      : x
  );

  // 5) Recompute schedule from 09:00 using durations + travel
  let current = new Date(`${date}T09:00:00`);
  const recomputed = nextList.map((p, idx) => {
    const seedDur = typeof (p as any)._seedDur === 'number' ? (p as any)._seedDur : undefined;
    const cat = (p as any)._category as string | undefined;
    const dur = Math.max(seedDur ?? 0, minFor(cat, 'balanced')); // replan default to 'balanced' pace
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
      location: p.location,
      description: p.description
    };
  });

  const polished = await formatTimelineWithLLM(recomputed, { city, vibes: [], pace: 'balanced' });
  return NextResponse.json({ stops: polished, note: `Adjusted for mood: ${mood}` });
}
