// lib/providers/places.ts
import OpenAI from "openai";
import { verifyPlaceHoursByName, resolveBestBranchForChain } from "./hours";

export type ProviderPlace = {
  name: string;
  category?: string;
  neighborhood?: string;
  location?: string;
  duration_min?: number;
  description?: string;
  url?: string;
  vibe_tags?: string[];
  energy_tags?: string[];
  // verified
  hours?: {
    openNow?: boolean;
    weekdayText?: string[];
  };
};

export type FetchExtraPlacesParams = {
  city: string;
  vibes?: string[];
  neighborhoodsHint?: string;
  wantCategories?: string[];
  excludeNames?: string[];
  limit?: number;
};

const OPENAI_ENABLED = !!process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = process.env.OPENAI_PLACES_MODEL || "gpt-4o-mini";

const ALLOWED_CATEGORIES = [
  "park","walk","view","landmark","museum","gallery","market",
  "breakfast","coffee","lunch","snack","dinner","shopping","show","bar","drinks"
];

const DEFAULT_DURATIONS: Record<string, number> = {
  park: 60, walk: 60, view: 45, landmark: 45, museum: 90, gallery: 60, market: 60,
  breakfast: 40, coffee: 30, lunch: 60, snack: 25, dinner: 90, shopping: 60, show: 120, bar: 60, drinks: 60,
};

const STATIC_PLACES_NYC: ProviderPlace[] = [
  { name: 'Central Park Ramble', category: 'park', neighborhood: 'Central Park', duration_min: 60, description: 'Wooded paths and birding in the Ramble.', url: 'https://www.centralparknyc.org/' , vibe_tags: ['classic','local','nature','chill'] },
  { name: 'The High Line', category: 'walk', neighborhood: 'Chelsea', duration_min: 60, description: 'Elevated park with art and views.', url: 'https://www.thehighline.org/', vibe_tags: ['classic','curator','local','nature','artsy'] },
  { name: 'Brooklyn Heights Promenade', category: 'walk', neighborhood: 'Brooklyn Heights', duration_min: 45, description: 'Classic skyline views over Lower Manhattan.', vibe_tags: ['classic','local','nature','view'] },
  { name: 'Washington Square Park', category: 'park', neighborhood: 'Greenwich Village', duration_min: 45, description: 'Arch, buskers, chess tables.', vibe_tags: ['classic','local','nature','historic'] },
  { name: 'Bryant Park', category: 'park', neighborhood: 'Midtown', duration_min: 45, description: 'Green lawn, reading room, seasonal events.', vibe_tags: ['classic','local','nature'] },
  { name: 'Riverside Park (Upper West)', category: 'walk', neighborhood: 'Upper West Side', duration_min: 60, description: 'Hudson River path and gardens.', vibe_tags: ['classic','local','nature'] },
  { name: 'The Met (Metropolitan Museum of Art)', category: 'museum', neighborhood: 'Upper East Side', duration_min: 90, description: 'World-class art collection.', url: 'https://www.metmuseum.org/', vibe_tags: ['classic','curator','historic'] },
  { name: 'MoMA', category: 'museum', neighborhood: 'Midtown', duration_min: 90, description: 'Modern and contemporary art highlights.', url: 'https://www.moma.org/', vibe_tags: ['classic','curator'] },
  { name: 'The Cloisters', category: 'museum', neighborhood: 'Fort Tryon', duration_min: 90, description: 'Medieval art in a tranquil setting.', url: 'https://www.metmuseum.org/visit/plan-your-visit/met-cloisters', vibe_tags: ['classic','curator','local','historic','nature'] },
  { name: 'Staten Island Ferry (Free Ride)', category: 'view', neighborhood: 'Financial District', duration_min: 60, description: 'Harbor views & Statue of Liberty (free).', url: 'https://www.siferry.com/', vibe_tags: ['classic','local','view','nature'] },
  { name: 'Grand Central Terminal', category: 'landmark', neighborhood: 'Midtown', duration_min: 40, description: 'Historic landmark with celestial ceiling.', vibe_tags: ['classic','curator','historic'] },
  { name: 'New York Public Library – Main Branch', category: 'landmark', neighborhood: 'Midtown', duration_min: 40, description: 'Beaux-Arts icon (Rose Main Reading Room).', vibe_tags: ['classic','curator','historic'] },
  { name: 'Tenement Museum (Exterior/Neighborhood Walk)', category: 'walk', neighborhood: 'Lower East Side', duration_min: 60, description: 'Historic LES streets; museum tours by ticket.', url: 'https://www.tenement.org/', vibe_tags: ['classic','curator','local','historic'] },
  { name: 'Domino Park', category: 'park', neighborhood: 'Williamsburg', duration_min: 60, description: 'Waterfront park with skyline views.', vibe_tags: ['classic','local','nature','view'] },
  { name: 'Brooklyn Bridge Park – Piers 1–3', category: 'park', neighborhood: 'DUMBO', duration_min: 60, description: 'Green space + waterfront views.', vibe_tags: ['classic','local','nature','view'] },
];

function normName(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sanitizeAreaText(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (
    lower === 'multiple' ||
    lower === 'multiple location' ||
    lower === 'multiple locations' ||
    lower === 'one location'
  ) {
    return undefined;
  }
  if (/\b(multiple|various|several)\s+locations?\b/.test(lower)) return undefined;
  return trimmed;
}

function filterByParams(list: ProviderPlace[], p: FetchExtraPlacesParams): ProviderPlace[] {
  let out = list;

  if (p.wantCategories?.length) {
    const want = new Set(p.wantCategories.map(c => c.toLowerCase()));
    out = out.filter(x => x.category && want.has(x.category.toLowerCase()));
  }

  if (p.vibes?.length) {
    const vset = new Set(p.vibes.map(v => v.toLowerCase()));
    out = out.filter(x => (x.vibe_tags || []).some(v => vset.has(v.toLowerCase())));
  }

  if (p.neighborhoodsHint) {
    const hint = p.neighborhoodsHint.toLowerCase();
    out.sort((a, b) => {
      const aHit = (a.neighborhood || a.location || '').toLowerCase().includes(hint) ? 0 : 1;
      const bHit = (b.neighborhood || b.location || '').toLowerCase().includes(hint) ? 0 : 1;
      return aHit - bHit;
    });
  }

  if (p.excludeNames?.length) {
    const ex = new Set(p.excludeNames.map(normName));
    out = out.filter(x => !ex.has(normName(x.name)));
  }

  return out;
}

function coerceCategory(s?: string): string | undefined {
  if (!s) return;
  const c = s.toLowerCase();
  return ALLOWED_CATEGORIES.includes(c) ? c : undefined;
}

function coerceDuration(cat?: string, d?: number): number | undefined {
  if (typeof d === "number" && d > 0) return Math.min(180, Math.max(20, d));
  if (!cat) return undefined;
  return DEFAULT_DURATIONS[cat] ?? undefined;
}

function dedupeByName(a: ProviderPlace[]): ProviderPlace[] {
  const seen = new Set<string>();
  const out: ProviderPlace[] = [];
  for (const p of a) {
    const key = normName(p.name);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

function findFirstJsonObject(text: string | null | undefined): any | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const jsonCandidate = text.slice(start, end + 1);
  try {
    return JSON.parse(jsonCandidate);
  } catch {
    return null;
  }
}

async function getFromOpenAI(params: FetchExtraPlacesParams): Promise<ProviderPlace[]> {
  if (!OPENAI_ENABLED) return [];

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const system = `
You are a travel POI suggester that outputs STRICT JSON (no prose).
Only include real places in ${params.city}.
NEVER say "multiple locations" — pick ONE best branch near "${params.neighborhoodsHint || "a central NYC area"}".
If a place is a chain, return a single branch (with neighborhood) that best matches the area hint.
Prefer non-restaurant activities unless the vibe includes "local" or "classic".
Categories MUST be one of: ${ALLOWED_CATEGORIES.join(", ")}.
Keep neighborhoods short (e.g., "West Village"). Provide a concise description (<= 200 chars).
If unsure about a URL, omit it. Return <= ${params.limit ?? 20} items.
JSON schema:
{ "places": [ { "name": "string", "category": ${JSON.stringify(ALLOWED_CATEGORIES)}, "neighborhood": "string (optional)", "location": "string (optional)", "duration_min": "number (optional)", "description": "string (optional)", "url": "https://… (optional)", "vibe_tags": ["string"] (optional), "energy_tags": ["string"] (optional) } ] }
`.trim();

  const userPayload = {
    city: params.city,
    vibes: params.vibes || [],
    neighborhoodsHint: params.neighborhoodsHint || null,
    wantCategories: params.wantCategories || [],
  };

  const completion = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(userPayload) }
    ],
  });

  const raw = completion.choices?.[0]?.message?.content ?? "";
  const parsed = findFirstJsonObject(raw);
  const arr: any[] = Array.isArray(parsed?.places) ? parsed.places : [];

  const cleaned: ProviderPlace[] = arr.map((p: any) => {
    const cat = coerceCategory(p?.category);
    const dur = coerceDuration(cat, p?.duration_min);
    const url = typeof p?.url === "string" && /^https?:\/\//i.test(p.url) ? p.url : undefined;
    const neighborhood = sanitizeAreaText(p?.neighborhood) ?? sanitizeAreaText(p?.location);
    let location = sanitizeAreaText(p?.location) ?? sanitizeAreaText(p?.neighborhood);
    if (!location && neighborhood) location = neighborhood;

    const place: ProviderPlace = {
      name: String(p?.name || "").slice(0, 140),
      category: cat,
      neighborhood,
      location,
      duration_min: dur,
      description: p?.description ? String(p.description).slice(0, 240) : undefined,
      url,
      vibe_tags: Array.isArray(p?.vibe_tags) ? p.vibe_tags.slice(0, 6) : undefined,
      energy_tags: Array.isArray(p?.energy_tags) ? p.energy_tags.slice(0, 6) : undefined,
    };
    return place;
  }).filter((x: ProviderPlace) => !!x.name && !!x.category);

  return cleaned;
}

// Static seed fetch
async function getFromStaticSeed(params: FetchExtraPlacesParams): Promise<ProviderPlace[]> {
  if (!/new york/i.test(params.city)) return [];
  const filtered = filterByParams(STATIC_PLACES_NYC, params);
  const limit = params.limit ?? 20;
  return filtered.slice(0, limit);
}

// Verify hours + resolve chain branch for each place
async function enrichWithHoursAndBranch(p: ProviderPlace, city: string, areaHint?: string): Promise<ProviderPlace> {
  // If it looks like a chain, resolve best branch near the hint
  if (!p.neighborhood && !p.location) {
    const branch = await resolveBestBranchForChain(p.name, city, areaHint);
    if (branch) {
      p.location = branch.address || branch.neighborhood || p.location;
      p.neighborhood = branch.neighborhood || p.neighborhood;
    }
  }

  // Verify hours by name (and possibly fill website)
  try {
    const { hours, website, bestBranch } = await verifyPlaceHoursByName(p.name, city);
    if (hours) p.hours = { openNow: hours.openNow, weekdayText: hours.weekdayText };
    if (website && !p.url) p.url = website;
    // If best branch is different and has a neighborhood, prefer it
    if (bestBranch?.neighborhood && !p.neighborhood) p.neighborhood = bestBranch.neighborhood;
    if (bestBranch?.address && !p.location) p.location = bestBranch.address;
  } catch {
    // ignore
  }

  return p;
}

export async function fetchExtraPlaces(params: FetchExtraPlacesParams): Promise<ProviderPlace[]> {
  const limit = params.limit ?? 20;

  let llm: ProviderPlace[] = [];
  try {
    llm = await getFromOpenAI(params);
  } catch {
    llm = [];
  }
  const seed = await getFromStaticSeed(params);

  // Merge + dedupe
  const merged = dedupeByName([...llm, ...seed]);
  // Enrich with hours/branch (parallel, but keep it reasonable)
  const enriched = await Promise.all(
    merged.map(p => enrichWithHoursAndBranch({ ...p }, params.city, params.neighborhoodsHint))
  );

  const filtered = filterByParams(enriched, params);
  return filtered.slice(0, limit);
}
