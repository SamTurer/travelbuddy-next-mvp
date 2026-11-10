import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { planDay } from '@/lib/planner';

const BodySchema = z.object({
  city: z.string(),
  date: z.string(),
  vibes: z.array(z.string()).default([]),
  pace: z.enum(['chill', 'balanced', 'max']),
  focusArea: z.string().optional().nullable(),
  locks: z.array(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const itinerary = await planDay(parsed.data);
    return NextResponse.json({
      stops: itinerary.stops,
      warnings: itinerary.warnings,
      mapsUrl: itinerary.mapsUrl,
      bookAhead: itinerary.bookAhead,
    });
  } catch (err: unknown) {
    console.error('[api/generate-itinerary] error:', err);
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
