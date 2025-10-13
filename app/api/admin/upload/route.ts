import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

type Out = {
  name: string;
  category: string;
  neighborhood?: string;
  duration_min: number;
  vibe_tags: string[];
  energy_tags: string[];
  description: string;
  location: string;
};

const DATA_PATH = path.join(process.cwd(), 'app', 'data', 'nyc-places.json');

function normTags(v?: string | string[], fallback: string[] = []) {
  if (!v) return fallback;
  if (Array.isArray(v)) return v.map(s => s.trim()).filter(Boolean);
  return v.split(',').map((s: string) => s.trim()).filter(Boolean);
}

function toOut(p: any): Out {
  return {
    name: p.name,
    category: p.category || 'other',
    neighborhood: p.neighborhood,
    duration_min: p.duration_min ? Number(p.duration_min) : 60,
    vibe_tags: normTags(p.vibe_tags, []),
    energy_tags: normTags(p.energy_tags, []),
    description: p.description || '',
    location: p.location || (p.neighborhood || '')
  };
}

function dedupe(existing: Out[], incoming: Out[]): Out[] {
  const key = (x: Out) => `${x.name.toLowerCase()}|${(x.neighborhood || '').toLowerCase()}`;
  const map = new Map<string, Out>();
  for (const e of existing) map.set(key(e), e);
  for (const i of incoming) map.set(key(i), i);
  return Array.from(map.values());
}

export async function POST(req: NextRequest) {
  const { content, fileName } = await req.json();
  if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 });

  let incoming: any[] = [];
  try {
    if (fileName?.endsWith('.json') || content.trim().startsWith('[')) {
      incoming = JSON.parse(content);
    } else {
      // CSV
      incoming = parse(content, { columns: true, skip_empty_lines: true }) as any[];
    }
  } catch (e:any) {
    return NextResponse.json({ error: 'Failed to parse CSV/JSON: ' + e.message }, { status: 400 });
  }

  const normalized = incoming.filter(r => r?.name).map(toOut);
  const existing: Out[] = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const before = existing.length;
  const merged = dedupe(existing, normalized);

  fs.writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2));
  return NextResponse.json({ added: merged.length - before, total: merged.length });
}
