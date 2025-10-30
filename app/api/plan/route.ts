// app/api/plan/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildItinerary } from '@/lib/planner';
import { enrichLocksWithAI } from '@/lib/ai';
import { getPlacesDataset } from '@/lib/places-dataset';

export const runtime = 'nodejs';

const BodySchema = z.object({
  city: z.string().default('New York City'),
  date: z.string().default(() => new Date().toISOString().slice(0, 10)),
  vibes: z.array(z.string()).default([]),
  pace: z.enum(['chill', 'balanced', 'max']).default('balanced'),
  focusArea: z.string().optional().nullable(),
  locks: z.array(z.any()).optional().default([]),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    // Normalize incoming locks → objects with at least `title`
    const rawLocks: { title: string; location?: string; description?: string; time?: string }[] =
      (parsed.data.locks || []).map((l: any) =>
        typeof l === 'string'
          ? { title: l }
          : { title: l?.title ?? '', location: l?.location, description: l?.description, time: l?.time || l?.start }
      );

    // 🔮 AI enrichment (optional, no-ops without OPENAI_API_KEY)
    const aiLocks = await enrichLocksWithAI(rawLocks, {
      city: parsed.data.city,
      date: parsed.data.date,
      vibes: parsed.data.vibes, // pass vibes
    });

    const stops = await buildItinerary(
      { ...parsed.data, locks: aiLocks },
      getPlacesDataset()
    );

    return NextResponse.json({ stops });
  } catch (err: any) {
    console.error('[api/plan] error:', err);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
