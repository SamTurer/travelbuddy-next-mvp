import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { coerceManhattanFocus } from '@/lib/areas';
import { planDay } from '@/lib/planner';

export const runtime = 'nodejs';

const BodySchema = z.object({
  city: z.string().default('New York City'),
  date: z.string().default(() => new Date().toISOString().slice(0, 10)),
  vibes: z.array(z.string()).default([]),
  pace: z.enum(['chill', 'balanced', 'max']).default('balanced'),
  focusArea: z.string().optional().nullable(),
  locks: z.array(z.any()).optional().default([]),
  startLocation: z
    .object({ lat: z.number(), lng: z.number(), label: z.string().optional() })
    .optional()
    .nullable(),
});

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const json = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const buildStart = Date.now();
    const itinerary = await planDay({
      city: parsed.data.city,
      date: parsed.data.date,
      vibes: parsed.data.vibes,
      pace: parsed.data.pace,
      focusArea: coerceManhattanFocus(parsed.data.focusArea),
      locks: parsed.data.locks,
      startLocation: parsed.data.startLocation,
    });
    console.log(`[PERF] planDay: ${Date.now() - buildStart}ms`);
    console.log(`[PERF] TOTAL: ${Date.now() - startTime}ms`);

    return NextResponse.json({
      stops: itinerary.stops,
      warnings: itinerary.warnings,
      mapsUrl: itinerary.mapsUrl,
      bookAhead: itinerary.bookAhead,
      cluster: itinerary.cluster,
    });
  } catch (err: unknown) {
    console.error('[api/plan] error:', err);
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
