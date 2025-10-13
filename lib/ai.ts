// lib/ai.ts
import { z } from 'zod';

// Optional: requires OPENAI_API_KEY in .env.local. If missing, this module no-ops.
const EnrichedLockSchema = z.object({
  title: z.string(),               // canonical name (no time/neighborhood tokens)
  location: z.string().optional(), // neighborhood/area if evident
  description: z.string().optional(),
  time: z.string().optional(),     // "H:MM am/pm" or "HH:MM"
  category: z.enum([
    'breakfast','coffee','lunch','dinner','bar','show','museum','gallery','park','walk','shopping','market','landmark','view','custom'
  ]).optional(),
  duration_min: z.number().int().positive().optional(), // inferred duration
  url: z.string().url().optional(), // optional, best effort (may be omitted)
});

export type EnrichedLock = z.infer<typeof EnrichedLockSchema>;

const ResponseSchema = z.object({ locks: z.array(EnrichedLockSchema) });

type EnrichArgs = {
  city: string;
  date: string;
  vibes?: string[];
};

export async function enrichLocksWithAI(
  rawLocks: Array<{ title: string; location?: string; description?: string; time?: string }>,
  { city, date, vibes }: EnrichArgs
): Promise<EnrichedLock[]> {
  if (!process.env.OPENAI_API_KEY) {
    // No key → passthrough
    return rawLocks.map(l => ({ ...l }));
  }

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const system = `You extract clean, structured details from messy "must-do" text for a one-day itinerary.

Return STRICT JSON. For each input:
- 'title': short canonical proper name (no time or neighborhood tokens in title).
- 'time': if a time is present, normalize to "H:MM am/pm" OR "HH:MM" (choose whichever fits each item).
- 'location': neighborhood/area if evident ("Upper West Side", "Lower East Side", "Williamsburg", etc.).
- 'category': one of {breakfast, coffee, lunch, dinner, bar, show, museum, gallery, park, walk, shopping, market, landmark, view, custom}.
- 'duration_min': infer typical dwell time from category (breakfast/coffee 40-45, lunch 60, dinner 75-90, show ~120, museum 90-120, bar 60, walk/park 40-60, etc.). Prefer a single integer.
- 'url': include a likely official site if you KNOW it; otherwise omit. Do NOT fabricate specifics.

Be conservative: omit any field if uncertain. Keep outputs minimal and factual.`;

  const examples = [
    { in: "Celeste UWS 7pm", out: { title: "Celeste", location: "Upper West Side", time: "7:00 pm", category: "dinner", duration_min: 90 } },
    { in: "Comedy Cellar late show", out: { title: "Comedy Cellar", category: "show", time: "9:30 pm", duration_min: 120 } },
    { in: "The Met in afternoon", out: { title: "The Metropolitan Museum of Art", category: "museum", duration_min: 120 } },
  ];

  const userPayload = {
    city, date, vibes: vibes ?? [],
    locks: rawLocks.map(l => ({
      title: l.title, location: l.location, description: l.description, time: l.time
    }))
  };

  const userMsg =
`Examples:
${examples.map(e => `- ${e.in} -> ${JSON.stringify(e.out)}`).join('\n')}

City: ${city}
Date: ${date}
Vibes: ${JSON.stringify(vibes ?? [])}
Input locks (array of objects with {title,location?,description?,time?}):
${JSON.stringify(userPayload.locks, null, 2)}

Return ONLY valid JSON: {"locks":[{...}]}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg }
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim() || "";
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return rawLocks.map(l => ({ ...l }));

    const parsed = JSON.parse(text.slice(start, end + 1));
    const safe = ResponseSchema.safeParse(parsed);
    if (!safe.success) return rawLocks.map(l => ({ ...l }));

    // merge ai → original (prefer ai fields where present)
    return rawLocks.map((orig, i) => {
      const ai = safe.data.locks[i] || {};
      return {
        title: ai.title || orig.title,
        location: ai.location ?? orig.location,
        description: ai.description ?? orig.description,
        time: ai.time ?? orig.time,
        category: ai.category,
        duration_min: ai.duration_min,
        url: ai.url,
      };
    });
  } catch {
    return rawLocks.map(l => ({ ...l }));
  }
}
