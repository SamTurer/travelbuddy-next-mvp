// app/api/generate-itinerary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import places from '../../../data/nyc-places.json';
import { buildItinerary } from '@/lib/planner';


const BodySchema = z.object({
  city: z.string(),
  date: z.string(), // YYYY-MM-DD
  vibes: z.array(z.string()),
  pace: z.enum(['chill', 'balanced', 'max']),
  locks: z.array(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const stops = await buildItinerary(parsed.data, places as any[]);
    return NextResponse.json({ stops });
  } catch (err: any) {
    console.error('[api/generate-itinerary] error:', err);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
