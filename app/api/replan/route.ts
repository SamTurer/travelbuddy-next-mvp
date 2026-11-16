import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { coerceManhattanFocus } from '@/lib/areas';
import { replanItinerary } from '@/lib/planner';

export const runtime = 'nodejs';

const StopSchema = z
  .object({
    time: z.string(),
    title: z.string(),
    location: z.string(),
    description: z.string().optional(),
  })
  .passthrough();

const BodySchema = z.object({
  city: z.string(),
  date: z.string(),
  mood: z.string(),
  pace: z.enum(['chill', 'balanced', 'max']).optional(),
  vibes: z.array(z.string()).optional(),
  focusArea: z.string().optional().nullable(),
  replaceIndex: z.number().int().nonnegative().optional(),
  currentStops: z.array(StopSchema),
});

export async function POST(req: NextRequest) {
  const json = await req.json();
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  if (parsed.data.currentStops.length === 0) {
    return NextResponse.json({ error: 'No stops to adjust' }, { status: 400 });
  }

  const itinerary = await replanItinerary({
    city: parsed.data.city,
    date: parsed.data.date,
    mood: parsed.data.mood,
    pace: parsed.data.pace,
    vibes: parsed.data.vibes,
    focusArea: coerceManhattanFocus(parsed.data.focusArea),
    replaceIndex: parsed.data.replaceIndex ?? 0,
    stops: parsed.data.currentStops as never,
  });

  return NextResponse.json({
    stops: itinerary.stops,
    warnings: itinerary.warnings,
    mapsUrl: itinerary.mapsUrl,
    bookAhead: itinerary.bookAhead,
    note: itinerary.warnings[0] || `Tweaked that stop for ${parsed.data.mood}.`,
  });
}
