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

    const rawLocks = (parsed.data.locks || []).map((lock: { title?: string; location?: string; description?: string; time?: string; start?: string } | string) =>
      typeof lock === 'string'
        ? { title: lock }
        : {
            title: lock?.title ?? '',
            location: lock?.location,
            description: lock?.description,
            time: lock?.time || lock?.start,
          }
    );

    const enriched = await enrichLocksWithAI(rawLocks, {
      city: parsed.data.city,
      date: parsed.data.date,
      vibes: parsed.data.vibes,
    });

    return NextResponse.json({ locks: enriched });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
