import { getPlaces } from './places';
import { parseMustDo, type LockInput } from './must-dos';
import { grokComplete, parseJsonObject, xaiEnabled } from './grok';
import { formatMinutes } from './time';

export type EnrichedLock = {
  title: string;
  location?: string;
  description?: string;
  time?: string;
  category?: string;
  duration_min?: number;
  matched?: boolean;
};

type EnrichArgs = {
  city: string;
  date: string;
  vibes?: string[];
};

/**
 * Must-do parsing always runs the deterministic parser.
 * When XAI_API_KEY is set, Grok may add a short description. It cannot override a parsed time.
 */
export async function enrichLocksWithAI(
  rawLocks: Array<{ title: string; location?: string; description?: string; time?: string }>,
  _context: EnrichArgs
): Promise<EnrichedLock[]> {
  const places = getPlaces();
  const parsed = rawLocks.map((lock) => {
    const item = parseMustDo(lock as LockInput, places);
    if (!item) return { title: lock.title, time: lock.time, location: lock.location, description: lock.description };
    return {
      title: item.title,
      location: item.neighborhood,
      description: item.place?.description || lock.description,
      time: item.pinnedStart != null ? formatMinutes(item.pinnedStart) : undefined,
      category: item.category,
      duration_min: item.duration,
      matched: Boolean(item.place),
    } satisfies EnrichedLock;
  });

  if (!xaiEnabled()) return parsed;

  const text = await grokComplete(
    [
      {
        role: 'system',
        content:
          'You help a NYC itinerary planner. Return JSON {"notes": string[]} with one short sentence per must-do, same length and order. Do not rename places or change times.',
      },
      { role: 'user', content: JSON.stringify(parsed.map((lock) => lock.title)) },
    ],
    { temperature: 0.2, timeoutMs: 8000 }
  );
  if (!text) return parsed;
  try {
    const notes = (parseJsonObject(text) as { notes?: string[] }).notes;
    if (!notes || notes.length !== parsed.length) return parsed;
    return parsed.map((lock, index) => ({
      ...lock,
      description: notes[index]?.trim() || lock.description,
    }));
  } catch {
    return parsed;
  }
}
