// app/api/enrich-locks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enrichLocksWithAI } from '@/lib/ai';

const BodySchema = z.object({
  city: z.string(),
  date: z.string(),
  vibes: z.array(z.string()).default([]),
  locks: z.array(z.any()),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const rawLocks = (parsed.data.locks || []).map((l: any) =>
      typeof l === 'string'
        ? { title: l }
        : { title: l?.title ?? '', location: l?.location, description: l?.description, time: l?.time || l?.start }
    );

    const enriched = await enrichLocksWithAI(rawLocks, {
      city: parsed.data.city,
      date: parsed.data.date,
      vibes: parsed.data.vibes,
    });

    return NextResponse.json({ locks: enriched });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
