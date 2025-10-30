import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { travelMinutesBetween } from '@/lib/geo';
import { getFocusAreaKeys, normalizeAreaValue } from '@/lib/areas';
import { getPlacesDataset } from '@/lib/places-dataset';

const BodySchema = z.object({
  city: z.string(),
  date: z.string(),
  index: z.number().int().nonnegative(),
  target: z.object({
    time: z.string(),
    title: z.string(),
    location: z.string().optional(),
    description: z.string().optional(),
  }),
  prev: z.object({ title: z.string(), location: z.string().optional() }).optional(),
  next: z.object({ title: z.string(), location: z.string().optional() }).optional(),
  existingTitles: z.array(z.string()),
  mood: z.string().optional(),
  focusArea: z.string().optional().nullable(),
});

type Place = {
  name: string;
  category?: string;
  neighborhood?: string;
  location?: string;
  duration_min?: number;
  description?: string;
  url?: string;
};

function ensureGoogleMapsUrl(url: string | undefined, location: string, title: string): string {
  if (url && /google\.(com|\w{2,})\/maps/i.test(url)) return url;
  const query = encodeURIComponent(`${title} ${location}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function recommendedTravelMode(minutes: number): 'walk' | 'transit' {
  if (!isFinite(minutes) || minutes <= 0) return 'walk';
  return minutes <= 17 ? 'walk' : 'transit';
}

function inferCategoryFromName(name: string): string | undefined {
  const t = name.toLowerCase();
  if (t.includes('dinner')) return 'dinner';
  if (t.includes('lunch')) return 'lunch';
  if (t.includes('breakfast') || t.includes('brunch') || t.includes('bagel')) return 'breakfast';
  if (t.includes('coffee') || t.includes('cafe') || t.includes('espresso')) return 'coffee';
  if (t.includes('museum') || t.includes('gallery')) return 'museum';
  if (t.includes('park') || t.includes('walk')) return 'park';
  if (t.includes('bar') || t.includes('cocktail')) return 'bar';
  return undefined;
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
  return cleaned || null;
}

function travelDescriptor(from: string | undefined, to: string | undefined) {
  if (!from || !to) return null;
  const minutes = Math.max(1, travelMinutesBetween(from, to));
  const mode = recommendedTravelMode(minutes);
  const emoji = mode === 'walk' ? '🚶‍♂️' : '🚇';
  return `${emoji} ${Math.max(1, Math.round(minutes))} min ${mode === 'walk' ? 'walk' : 'transit'} to next stop`;
}

export async function POST(req: NextRequest) {
  const json = await req.json();
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { city, index, target, prev, next, existingTitles, mood, focusArea } = parsed.data;
  const all = getPlacesDataset() as Place[];
  const normalizedFocus = normalizeAreaValue(focusArea);
  const focusAreaKeys = getFocusAreaKeys(normalizedFocus);
  const focusAreaSet = new Set(focusAreaKeys);
  const focusEnabled = focusAreaSet.size > 0;
  const primaryFocusArea = focusAreaKeys[0] ?? null;
  if (focusEnabled) {
    const targetAreaKey = areaKeyFromString(target.location);
    if (targetAreaKey) focusAreaSet.add(targetAreaKey);
    const prevAreaKey = areaKeyFromString(prev?.location);
    if (prevAreaKey) focusAreaSet.add(prevAreaKey);
    const nextAreaKey = areaKeyFromString(next?.location);
    if (nextAreaKey) focusAreaSet.add(nextAreaKey);
  }

  const existing = new Set(existingTitles.map(t => t.toLowerCase()));
  existing.delete(target.title.toLowerCase());

  const targetMatch = all.find(p => p.name.toLowerCase() === target.title.toLowerCase());
  const targetCategory = targetMatch?.category || inferCategoryFromName(target.title);

  let candidates = all.filter(p => p.name.toLowerCase() !== target.title.toLowerCase());
  if (focusEnabled) {
    const filtered = candidates.filter(p => {
      const area = areaKeyFromString(p.neighborhood || p.location || '');
      return area ? focusAreaSet.has(area) : false;
    });
    if (filtered.length) {
      candidates = filtered;
    }
  }
  const moodNorm = mood?.toLowerCase() || '';

  if (moodNorm.includes('hungry')) {
    candidates = candidates.filter(p => {
      const cat = (p.category || '').toLowerCase();
      return ['dinner','lunch','breakfast','coffee','snack','restaurant','food'].includes(cat);
    });
  } else if (moodNorm.includes('weather')) {
    candidates = candidates.filter(p => {
      const cat = (p.category || '').toLowerCase();
      return !['park','walk','outdoors','view','market'].includes(cat);
    });
  } else if (moodNorm.includes('tired') || moodNorm.includes('less walking')) {
    const baseLoc = target.location || city;
    candidates = candidates.filter(p => {
      const loc = p.location || p.neighborhood || city;
      return travelMinutesBetween(baseLoc, loc) <= 20;
    });
  } else if (moodNorm.includes('vibe')) {
    const baseCategory = targetMatch?.category?.toLowerCase();
    if (baseCategory) {
      candidates = candidates.filter(p => (p.category || '').toLowerCase() !== baseCategory);
    }
  }

  if (targetCategory) {
    const filtered = candidates.filter(p => (p.category || '').toLowerCase() === targetCategory.toLowerCase());
    if (filtered.length) candidates = filtered;
  }

  const baseArea = areaKeyFromString(target.location);

  let best: Place | null = null;
  let bestScore = Infinity;

  for (const place of candidates) {
    const key = place.name.toLowerCase();
    if (existing.has(key)) continue;
    const area = areaKeyFromString(place.neighborhood || place.location || '');
    let score = 0;
    if (baseArea && area && baseArea !== area) score += 2.5;
    if (focusEnabled) {
      if (!area) {
        score += 4;
      } else if (!focusAreaSet.has(area)) {
        score += 10;
      } else if (primaryFocusArea && area !== primaryFocusArea) {
        score += 1.6;
      }
    }
    const prevLoc = prev?.location || target.location || city;
    const nextLoc = next?.location || target.location || city;
    score += travelMinutesBetween(prevLoc, place.location || place.neighborhood || city) / 20;
    score += travelMinutesBetween(place.location || place.neighborhood || city, nextLoc) / 20;
    if (score < bestScore) {
      bestScore = score;
      best = place;
    }
  }

  if (!best) {
    const fallback = all.find(p => !existing.has(p.name.toLowerCase()));
    best = fallback || all[0];
  }

  if (!best) {
    return NextResponse.json({ error: 'No replacement found' }, { status: 404 });
  }

  const location = best.location || best.neighborhood || target.location || city;

  return NextResponse.json({
    stop: {
      time: target.time,
      title: best.name,
      location,
      description: best.description || target.description || '',
      url: ensureGoogleMapsUrl(best.url, location, best.name),
    },
    prevTransit: prev ? travelDescriptor(prev.location || city, location) : null,
    nextTransit: next ? travelDescriptor(location, next.location || city) : null,
  });
}
