// app/plan/PlanClient.tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type PlanStop = {
  time: string;
  title: string;
  location: string;
  description?: string;
  url?: string;
};

export default function PlanClient() {
  const searchParams = useSearchParams();
  const [stops, setStops] = useState<PlanStop[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo(() => {
    // Adjust these keys to match your existing querystring usage
    const city = searchParams.get('city') ?? 'New York';
    const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    // If you encode vibes as ?vibes=["nature","foodie"], we parse JSON.
    // If you send multiple ?vibe= params, swap to searchParams.getAll('vibe')
    let vibes: string[] = [];
    const vibesParam = searchParams.get('vibes');
    if (vibesParam) {
      try { vibes = JSON.parse(vibesParam); } catch { vibes = []; }
    } else {
      vibes = searchParams.getAll('vibe');
    }
    const pace = searchParams.get('pace') ?? 'balanced';

    // Must-dos: if you pass a JSON string in ?mustDos=...
    let locks: unknown[] = [];
    const md = searchParams.get('mustDos');
    if (md) {
      try { locks = JSON.parse(md); } catch { locks = []; }
    }

    return { city, date, vibes, pace, locks };
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const out: PlanStop[] = Array.isArray(data) ? data : (data.stops ?? []);
        if (!cancelled) setStops(out);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to build itinerary.');
      }
    })();
    return () => { cancelled = true; };
  }, [payload]);

  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!stops) return <div className="p-6">Building your itinerary…</div>;

  return (
    <div className="p-6 space-y-4">
      {stops.map((s, i) => (
        <div key={i} className="rounded-lg border p-4">
          <div className="text-sm opacity-70">{s.time}</div>
          <div className="font-medium">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            ) : (
              s.title
            )}
          </div>
          <div className="text-sm">{s.location}</div>
          {s.description && <p className="text-sm opacity-80 mt-1">{s.description}</p>}
        </div>
      ))}
    </div>
  );
}
