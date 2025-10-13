'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadDraft } from '@/lib/draft';
import type { TripDraft, Stop as PlanStop, MustDo } from '@/lib/types';
import { travelMinutesBetween } from '@/lib/geo';

function mapsSearchUrl(title: string, location: string, city: string) {
  const q = encodeURIComponent(`${title} ${location} ${city}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function categoryEmoji(title: string) {
  const t = title.toLowerCase();
  if (/\b(breakfast|bagel|brunch|bakery)\b/.test(t)) return '🥐';
  if (/\b(coffee|latte|espresso|cafe)\b/.test(t)) return '☕️';
  if (/\b(lunch|sandwich|slice|pizza|burger|deli)\b/.test(t)) return '🍔';
  if (/\b(dinner|tasting|omakase|steak|italian|greek)\b/.test(t)) return '🍽️';
  if (/\b(bar|cocktail|speakeasy|wine)\b/.test(t)) return '🍸';
  if (/\b(museum|gallery|art)\b/.test(t)) return '🖼️';
  if (/\b(park|high line|central park|garden)\b/.test(t)) return '🌳';
  if (/\b(show|broadway|comedy|concert|theater|theatre)\b/.test(t)) return '🎭';
  if (/\b(view|dumbo|bridge|observatory)\b/.test(t)) return '🌆';
  if (/\b(shopping|soho)\b/.test(t)) return '🛍️';
  return '📍';
}

function stringifyMustDo(m: MustDo) {
  if (typeof m === 'string') return m;
  const parts = [m.title, m.time, m.location].filter(Boolean);
  return parts.join(' • ');
}

function recommendedTravelMode(minutes: number): 'walk' | 'transit' {
  if (!isFinite(minutes) || minutes <= 0) return 'walk';
  return minutes <= 17 ? 'walk' : 'transit';
}

function formatTransitDescription(prev: PlanStop | undefined, next: PlanStop | undefined, city: string): string | null {
  if (!prev || !next) return null;
  const from = prev.location || city;
  const to = next.location || city;
  const minutes = Math.max(1, travelMinutesBetween(from, to));
  const mode = recommendedTravelMode(minutes);
  const emoji = mode === 'walk' ? '🚶‍♂️' : '🚇';
  const label = mode === 'walk' ? 'walk' : 'transit';
  return `${emoji} ${Math.max(1, Math.round(minutes))} min ${label} to ${next.title}`;
}

function recalcTransit(stops: PlanStop[], city: string): PlanStop[] {
  const cloned = stops.map((s) => ({ ...s }));
  for (let i = 0; i < cloned.length; i++) {
    if (cloned[i].title === 'Transit') {
      let prev: PlanStop | undefined;
      let next: PlanStop | undefined;
      for (let j = i - 1; j >= 0; j--) {
        if (cloned[j].title !== 'Transit') {
          prev = cloned[j];
          break;
        }
      }
      for (let j = i + 1; j < cloned.length; j++) {
        if (cloned[j].title !== 'Transit') {
          next = cloned[j];
          break;
        }
      }
      const descriptor = formatTransitDescription(prev, next, city);
      if (descriptor) cloned[i].description = descriptor;
    }
  }
  return cloned;
}

export default function PlanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const debugParam = searchParams?.get('debug');
  const [debugOpen, setDebugOpen] = useState<boolean>(debugParam === '1');

  const [stops, setStops] = useState<PlanStop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingDay, setRefreshingDay] = useState(false);
  const [refreshingStop, setRefreshingStop] = useState<{ index: number; mood?: string } | null>(null);
  const [openReplan, setOpenReplan] = useState<number | null>(null);
  const [payloadUsed, setPayloadUsed] = useState<{
    city: string;
    date: string;
    vibes: string[];
    pace: TripDraft['pace'];
    locks: MustDo[];
  } | null>(null);

  // load + call API
  const fetchPlan = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const draft: TripDraft | null = loadDraft();
      if (!draft) {
        setError('No trip info found. Please start again.');
        setLoading(false);
        return;
      }

      const payload = {
        city: draft.city || 'New York City',
        date: draft.date || new Date().toISOString().slice(0, 10),
        vibes: draft.vibes || [],
        pace: draft.pace || 'balanced',
        locks: draft.mustDos || [],
      };
      setPayloadUsed(payload);

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const maybeJson = await res.json().catch(() => null);
        throw new Error(maybeJson?.error || `Request failed (${res.status})`);
      }

      const data = await res.json();
      const received: PlanStop[] = data?.stops || [];

      const withLinks = received.map((s) => {
        if (s.title === 'Transit') {
          return { ...s, url: undefined };
        }
        return {
          ...s,
          url:
            s.url ||
            mapsSearchUrl(
              s.title,
              s.location || (draft.city ?? 'New York City'),
              draft.city ?? 'New York City'
            ),
        };
      });

      setOpenReplan(null);
      setStops(recalcTransit(withLinks, payload.city || 'New York City'));
    } catch (e: any) {
      setError(e?.message || 'Something went wrong while generating your itinerary.');
    } finally {
      setLoading(false);
      setRefreshingDay(false);
      setRefreshingStop(null);
    }
  }, []);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const handleReplanDay = useCallback(async () => {
    setRefreshingDay(true);
    await fetchPlan();
  }, [fetchPlan]);

  const handleReplanStop = useCallback(
    async (nonTransitIndex: number, mood?: string) => {
      if (!payloadUsed || !stops) return;
      const nonTransitStops = stops.filter((s) => s.title !== 'Transit');
      const target = nonTransitStops[nonTransitIndex];
      if (!target) return;
      const prev = nonTransitStops[nonTransitIndex - 1];
      const next = nonTransitStops[nonTransitIndex + 1];

      setRefreshingStop({ index: nonTransitIndex, mood: mood ?? '__default__' });

      try {
        const res = await fetch('/api/replan-stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            city: payloadUsed.city,
            date: payloadUsed.date,
            index: nonTransitIndex,
            target,
            prev,
            next,
            existingTitles: nonTransitStops.map((s) => s.title),
            mood,
          }),
        });

        if (!res.ok) {
          const maybeJson = await res.json().catch(() => null);
          throw new Error(maybeJson?.error || `Request failed (${res.status})`);
        }

        const data = await res.json();
        const { stop: replacement } = data || {};
        if (!replacement) return;

        const updatedStops = [...stops];
        let seen = -1;
        for (let i = 0; i < updatedStops.length; i++) {
          const item = updatedStops[i];
          if (item.title === 'Transit') continue;
          seen += 1;
          if (seen === nonTransitIndex) {
            updatedStops[i] = {
              ...item,
              time: replacement.time,
              title: replacement.title,
              location: replacement.location,
              description: replacement.description,
              url: replacement.url,
            };
            break;
          }
        }
        setOpenReplan(null);
        setStops(recalcTransit(updatedStops, payloadUsed.city || 'New York City'));
      } catch (e: any) {
        setError(e?.message || 'Failed to replan stop.');
      } finally {
        setRefreshingStop(null);
      }
    },
    [payloadUsed, stops]
  );

  // derive date display + city
  const meta = useMemo(() => {
    try {
      const d = loadDraft();
      const city = d?.city || 'New York City';
      const dateISO = d?.date || new Date().toISOString().slice(0, 10);
      const date = new Date(dateISO + 'T00:00:00');
      const formatted = date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      return { city, formatted };
    } catch {
      return { city: 'New York City', formatted: '' };
    }
  }, []);

  return (
    <main className="container mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Your NYC Day Plan</h1>
          <p className="text-sm text-neutral-600">
            {meta.formatted && `${meta.formatted} • `}{meta.city}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReplanDay}
            disabled={loading || refreshingDay}
            className="rounded-md border px-3 py-1 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshingDay ? 'Replanning…' : 'Replan day'}
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-md border px-3 py-1 text-sm hover:bg-neutral-50"
          >
            Print
          </button>
          <button
            onClick={() => router.push('/must-dos')}
            className="rounded-md border px-3 py-1 text-sm hover:bg-neutral-50"
          >
            Edit must-dos
          </button>
        </div>
      </header>

      {/* NEW: Inputs / Debug panel */}
      {payloadUsed && (
        <section className="mb-6 rounded-2xl border p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Inputs</h2>
            <button
              onClick={() => setDebugOpen((v) => !v)}
              className="text-xs rounded-md border px-2 py-1 hover:bg-neutral-50"
            >
              {debugOpen ? 'Hide' : 'Show'}
            </button>
          </div>

          {debugOpen && (
            <div className="mt-3 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-neutral-500">City</div>
                  <div className="font-medium">{payloadUsed.city}</div>
                </div>
                <div>
                  <div className="text-neutral-500">Date</div>
                  <div className="font-medium">{payloadUsed.date}</div>
                </div>
                <div>
                  <div className="text-neutral-500">Pace</div>
                  <div className="font-medium capitalize">{payloadUsed.pace}</div>
                </div>
                <div>
                  <div className="text-neutral-500">Vibes</div>
                  <div className="flex flex-wrap gap-1">
                    {payloadUsed.vibes.length === 0 ? (
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">none</span>
                    ) : (
                      payloadUsed.vibes.map((v, i) => (
                        <span key={`${v}-${i}`} className="rounded bg-neutral-100 px-2 py-0.5 text-xs">
                          {v}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-neutral-500 mb-1">Must-dos</div>
                {payloadUsed.locks.length === 0 ? (
                  <div className="text-neutral-600">none</div>
                ) : (
                  <ul className="list-disc pl-5 space-y-1">
                    {payloadUsed.locks.map((m, i) => (
                      <li key={typeof m === 'string' ? `${m}-${i}` : `${m.title}-${i}`}>
                        {stringifyMustDo(m)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Raw JSON (collapsible details for deeper debugging) */}
              <details className="mt-2">
                <summary className="cursor-pointer text-neutral-500">Raw payload</summary>
                <pre className="mt-2 overflow-auto rounded bg-neutral-50 p-3 text-[11px] leading-relaxed">
                  {JSON.stringify(payloadUsed, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </section>
      )}

      {/* Status */}
      {loading && (
        <div className="rounded-2xl border p-6">
          <p className="animate-pulse">✨ Cooking up your perfect day…</p>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border p-6 text-red-600 space-y-3">
          <p>❌ Oops! {error}</p>
          <button
            onClick={() => router.back()}
            className="rounded-md border px-3 py-1 text-sm"
          >
            Go Back
          </button>
        </div>
      )}

      {!loading && !error && stops && stops.length === 0 && (
        <div className="rounded-2xl border p-6 space-y-3">
          <p>No stops found. Try adjusting your selections.</p>
          <button
            onClick={() => router.push('/must-dos')}
            className="rounded-md border px-3 py-1 text-sm"
          >
            Add a must-do
          </button>
        </div>
      )}

      {/* Timeline */}
      {!loading && !error && stops && stops.length > 0 && (
        <ol className="relative mt-2 ml-4">
          {/* vertical line */}
          <div className="absolute left-[-1px] top-0 h-full w-px bg-neutral-200" aria-hidden />
          {(() => {
            let nonTransitCounter = -1;
            return stops.map((s, idx) => {
              const isTransit = s.title === 'Transit';
              if (isTransit) {
                return (
                  <li key={idx} className="relative mb-4 pl-6">
                    <span className="absolute left-[-5px] top-[8px] h-2 w-2 rounded-full bg-neutral-300" />
                    <div className="border-l-2 border-dashed border-neutral-200 pl-3 text-xs italic text-neutral-600">
                      {s.description}
                    </div>
                  </li>
                );
              }

              nonTransitCounter += 1;
              const thisIdx = nonTransitCounter;
              const disableStop = refreshingDay || loading || (refreshingStop ? refreshingStop.index !== thisIdx : false);

              return (
                <li key={idx} className="relative mb-5 pl-6">
                  <span className="absolute left-[-6px] top-[6px] h-3 w-3 rounded-full border border-neutral-300 bg-white" />
                  <div className="rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm text-neutral-600">
                          <span className="inline-block rounded-md bg-neutral-100 px-2 py-0.5 text-xs">
                            {s.time}
                          </span>
                          <span aria-hidden>•</span>
                          <span className="truncate">{s.location}</span>
                        </div>
                        <h3 className="mt-1 text-lg font-semibold leading-snug">
                          <span className="mr-1" aria-hidden>
                            {categoryEmoji(s.title)}
                          </span>
                          {s.title}
                        </h3>
                        {s.description && (
                          <p className="mt-1 text-sm text-neutral-700">{s.description}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <div className="flex flex-col items-end gap-1 text-right">
                          <button
                            onClick={() => setOpenReplan(openReplan === thisIdx ? null : thisIdx)}
                            disabled={disableStop}
                            className="rounded-md border px-3 py-1 text-xs uppercase tracking-wide text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {openReplan === thisIdx ? 'Cancel' : 'Replan stop'}
                          </button>
                          {openReplan === thisIdx && (
                            <div className="flex w-48 flex-col gap-1 rounded-lg border bg-white p-2 shadow-sm">
                              <span className="text-[10px] uppercase text-neutral-500">Pick a tweak</span>
                              {[
                                { label: "I'm hungry", value: "I'm hungry" },
                                { label: 'Weather changed', value: 'Weather changed' },
                                { label: 'Different vibe', value: 'Different vibe' },
                                { label: "I'm tired", value: "I'm tired" },
                                { label: 'Surprise me', value: undefined },
                              ].map((option) => {
                                const moodKey = option.value ?? '__default__';
                                const isWorking =
                                  refreshingStop?.index === thisIdx && refreshingStop?.mood === moodKey;
                                return (
                                  <button
                                    key={option.label}
                                    onClick={() => handleReplanStop(thisIdx, option.value)}
                                    disabled={disableStop || isWorking}
                                    className="rounded-md border px-2 py-1 text-xs text-left text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {isWorking ? 'Replanning…' : option.label}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {s.url && (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50"
                            title="Open in Google Maps"
                          >
                            Open in Maps
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            });
          })()}
        </ol>
      )}
    </main>
  );
}
