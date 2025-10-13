/**
 * Usage:
 *  npx ts-node --compiler-options '{"module":"commonjs"}' scripts/ingest-guides.ts --input guides.csv
 *  npx ts-node --compiler-options '{"module":"commonjs"}' scripts/ingest-guides.ts --input guides.json
 *
 * Reads CSV or JSON of place records, normalizes them, merges with app/data/nyc-places.json,
 * de-duplicates by name+neighborhood, and writes back to the JSON file.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';

type In = {
  name: string;
  category?: string;
  sub_category?: string;
  neighborhood?: string;
  lat?: number;
  lon?: number;
  price_tier?: number;
  energy_tags?: string | string[];
  vibe_tags?: string | string[];
  duration_min?: number;
  open_hours?: any;
  description?: string;
  location?: string;
  source?: string;
};

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
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

function toOut(p: In): Out {
  return {
    name: p.name,
    category: p.category || 'other',
    neighborhood: p.neighborhood,
    duration_min: p.duration_min ?? 60,
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

async function readCSV(file: string): Promise<In[]> {
  const text = fs.readFileSync(file, 'utf-8');
  return new Promise((resolve, reject) => {
    parse(text, { columns: true, skip_empty_lines: true }, (err, records: any[]) => {
      if (err) return reject(err);
      resolve(records as In[]);
    });
  });
}

async function main(){
  const args = process.argv.slice(2);
  const i = args.indexOf('--input');
  if (i === -1 || !args[i+1]) {
    console.error('Usage: ts-node scripts/ingest-guides.ts --input guides.csv|guides.json');
    process.exit(1);
  }
  const input = args[i+1];

  let incoming: In[] = [];
  if (input.endsWith('.csv')) {
    incoming = await readCSV(input);
  } else if (input.endsWith('.json')) {
    incoming = JSON.parse(fs.readFileSync(input, 'utf-8'));
  } else {
    console.error('Input must be .csv or .json');
    process.exit(1);
  }

  const normalized = incoming.filter(r => r?.name).map(toOut);
  const existing: Out[] = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const merged = dedupe(existing, normalized);

  fs.writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2));
  console.log(`Merged ${normalized.length} records → ${merged.length} total in nyc-places.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
