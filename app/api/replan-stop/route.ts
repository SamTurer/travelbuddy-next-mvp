import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { replanItinerary } from '@/lib/planner';

export const runtime = 'nodejs';

const BodySchema = z.object({
  city: z.string(),
  date: z.string().optional(),
  index: z.number().int().nonnegative(),
  mood: z.string().optional(),
  focusArea: z.string().optional().nullable(),
  pace: z.enum(['chill', 'balanced', 'max']).optional(),
  vibes: z.array(z.string()).optional(),
  target: z.object({
    time: z.string(),
    title: z.string(),
    location: z.string().optional(),
    description: z.string().optional(),
  }),
  existingTitles: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const json = await req.json();
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { target, index, city } = parsed.data;
  const itinerary = await replanItinerary({
    city,
    date: parsed.data.date || new Date().toISOString().slice(0, 10),
    mood: parsed.data.mood || 'Different Vibe',
    pace: parsed.data.pace,
    vibes: parsed.data.vibes,
    focusArea: parsed.data.focusArea,
    replaceIndex: index,
    stops: [
      {
        time: target.time,
        title: target.title,
        location: target.location || city,
        description: target.description || '',
        kind: 'place',
      },
    ],
  });

  const stop = itinerary.stops.find((item) => item.kind === 'place');
  if (!stop) return NextResponse.json({ error: 'No replacement found' }, { status: 404 });
  return NextResponse.json({ stop, stops: itinerary.stops, warnings: itinerary.warnings });
}
