import { getPlaces } from './places';
import { matchDetail, parseMustDo, type LockInput } from './must-dos';
import { lookupPlaces, type LookedUpPlace } from './place-lookup';
import { grokComplete, parseJsonObject, xaiEnabled } from './grok';
import { formatMinutes } from './time';

export type EnrichedLock = {
  title: string;
  location?: string;
  description?: string;
  time?: string;
  /** Meal words without a clock, such as "for lunch". */
  detail?: string;
  category?: string;
  duration_min?: number;
  matched?: boolean;
  /** Google results for a must-do that is not on the list. Empty until the user confirms. */
  lookups?: LookedUpPlace[];
};

type EnrichArgs = {
  city: string;
  date: string;
  vibes?: string[];
};

export type EnrichOptions = {
  /** Injected in tests. Defaults to Google Places, which no-ops without a key. */
  lookup?: (query: string) => Promise<LookedUpPlace[]>;
  /** Injected in tests. Defaults to Grok, which no-ops without a key. */
  interpret?: (text: string) => Promise<string | null>;
};

async function defaultInterpret(text: string): Promise<string | null> {
  if (!xaiEnabled()) return null;
  const reply = await grokComplete(
    [
      {
        role: 'system',
        content:
          'Turn a messy New York must-do into a short Google Places search query. Return JSON only: {"query":"place name and neighborhood"}. Do not include an address, coordinates, or hours. If the words are already a place name, repeat them.',
      },
      { role: 'user', content: text },
    ],
    { temperature: 0, timeoutMs: 4000 }
  );
  if (!reply) return null;
  try {
    const query = (parseJsonObject(reply) as { query?: string }).query?.trim();
    return query || null;
  } catch {
    return null;
  }
}

/**
 * Must-do parsing always runs the deterministic parser.
 * When XAI_API_KEY is set, Grok may add a short description. It cannot override a parsed time.
 */
export async function enrichLocksWithAI(
  rawLocks: Array<{ title: string; location?: string; description?: string; time?: string; confirmedLookup?: LookedUpPlace }>,
  _context: EnrichArgs,
  options?: EnrichOptions
): Promise<EnrichedLock[]> {
  const places = getPlaces();
  const lookup = options?.lookup ?? ((query: string) => lookupPlaces(query));
  const interpret = options?.interpret ?? defaultInterpret;
  const parsed: EnrichedLock[] = [];
  for (const lock of rawLocks) {
    const item = parseMustDo(lock as LockInput, places);
    if (!item) {
      parsed.push({ title: lock.title, time: lock.time, location: lock.location, description: lock.description });
      continue;
    }
    const row: EnrichedLock = {
      title: item.title,
      location: item.neighborhood,
      description: item.place?.description || lock.description,
      time: item.pinnedStart != null ? formatMinutes(item.pinnedStart) : undefined,
      detail: matchDetail(item),
      category: item.category,
      duration_min: item.duration,
      matched: !item.plainText,
    };
    if (item.plainText && !lock.confirmedLookup) {
      const cleaned = item.title;
      let query = cleaned;
      try {
        const interpreted = await interpret(cleaned);
        if (interpreted && interpreted.length < 120) query = interpreted;
      } catch {
        query = cleaned;
      }
      try {
        const found = await lookup(query);
        if (found.length) row.lookups = found.slice(0, 3);
      } catch {
        // A lookup failure leaves the must-do as typed.
      }
    }
    parsed.push(row);
  }

  if (options || !xaiEnabled()) return parsed;

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
