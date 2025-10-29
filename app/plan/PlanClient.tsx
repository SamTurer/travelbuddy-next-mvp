// app/plan/PlanClient.tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadDraft } from '@/lib/draft';
import type { TripDraft } from '@/lib/types';
import { areaLabelForValue, normalizeAreaValue } from '@/lib/areas';

type PlanStop = {
  time: string;
  title: string;
  location: string;
  description?: string;
  url?: string;
};

type Pace = 'chill' | 'balanced' | 'max';

type PlanPayload = {
  city: string;
  date: string;
  vibes: string[];
  pace: Pace;
  focusArea: string | null;
  locks: unknown[];
};

const STOP_REPLAN_OPTIONS = [
  "I'm Hungry",
  "I'm Tired",
  "Weather Changed",
  'Different Vibe',
] as const;

type StopReplanMood = (typeof STOP_REPLAN_OPTIONS)[number];

export default function PlanClient() {
  const searchParams = useSearchParams();
  const [stops, setStops] = useState<PlanStop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TripDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dayReplanLoading, setDayReplanLoading] = useState(false);
  const [activityMenuOpen, setActivityMenuOpen] = useState<number | null>(null);
  const [activityReplanLoading, setActivityReplanLoading] = useState<number | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const lastActionRef = useRef<'full-day' | null>(null);

  useEffect(() => {
    try {
      setDraft(loadDraft());
    } catch {
      // ignore draft load errors; fall back to query params
    } finally {
      setDraftReady(true);
    }
  }, []);

  const payload = useMemo<PlanPayload | null>(() => {
    if (!draftReady) return null;
    // Adjust these keys to match your existing querystring usage
    const city = searchParams.get('city') ?? draft?.city ?? 'New York';
    const date =
      searchParams.get('date') ?? draft?.date ?? new Date().toISOString().slice(0, 10);
    // If you encode vibes as ?vibes=["classic","local"], we parse JSON.
    // If you send multiple ?vibe= params, swap to searchParams.getAll('vibe')
    let vibes: string[] = [];
    const vibesParam = searchParams.get('vibes');
    if (vibesParam) {
      try { vibes = JSON.parse(vibesParam); } catch { vibes = []; }
    } else {
      vibes = searchParams.getAll('vibe');
    }
    if ((!vibes || vibes.length === 0) && draft?.vibes?.length) {
      vibes = draft.vibes;
    }
    const paceRaw = (searchParams.get('pace') ?? draft?.pace ?? 'balanced') as string;
    const normalizedPace: Pace =
      paceRaw === 'chill' || paceRaw === 'max' ? paceRaw : 'balanced';

    let focusArea: string | null = null;
    const focusParam = searchParams.get('focusArea');
    if (focusParam) {
      focusArea = normalizeAreaValue(focusParam);
    } else if (draft?.focusArea) {
      focusArea = draft.focusArea || null;
    }

    // Must-dos: if you pass a JSON string in ?mustDos=...
    let locks: unknown[] = [];
    const md = searchParams.get('mustDos');
    if (md) {
      try { locks = JSON.parse(md); } catch { locks = []; }
    }
    if ((!locks || locks.length === 0) && draft?.mustDos?.length) {
      locks = draft.mustDos;
    }

    return { city, date, vibes, pace: normalizedPace, focusArea, locks };
  }, [searchParams, draft, draftReady]);

  const mustDoSummaries = useMemo(() => {
    if (!payload) return [];
    return (payload.locks ?? []).map((lock) => {
      if (typeof lock === 'string') {
        return lock;
      }
      if (lock && typeof lock === 'object') {
        const title = typeof (lock as any).title === 'string' ? (lock as any).title : null;
        const time = typeof (lock as any).time === 'string' ? (lock as any).time : null;
        const location = typeof (lock as any).location === 'string' ? (lock as any).location : null;
        const parts = [title, time, location].filter(Boolean);
        return (parts.length ? parts.join(' • ') : title) || 'Must-do';
      }
      return 'Must-do';
    }).filter(Boolean) as string[];
  }, [payload]);

  const buildMapsUrl = (stop: PlanStop) => {
    if (stop.url && /google\.(com|[a-z]{2,})\/maps/i.test(stop.url)) return stop.url;
    const querySource = `${stop.title} ${stop.location ?? ''}`.trim();
    const query = encodeURIComponent(querySource || stop.title);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  };

  const handleReplanDay = () => {
    if (!payload || dayReplanLoading || activityReplanLoading !== null) return;
    lastActionRef.current = 'full-day';
    setRefreshKey((key) => key + 1);
  };

  const handleStopReplan = async (activityIndex: number, mood: StopReplanMood) => {
    if (!payload || !stops || activityIndex < 0) return;
    const activityStops = stops.filter((s) => s.title !== 'Transit');
    if (!activityStops[activityIndex]) return;

    setActivityMenuOpen(null);
    setActivityReplanLoading(activityIndex);
    setInfoMessage(null);

    try {
      const res = await fetch('/api/replan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: payload.city,
          date: payload.date,
          mood,
          pace: payload.pace,
          vibes: payload.vibes,
          focusArea: payload.focusArea,
          replaceIndex: activityIndex,
          currentStops: activityStops,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const nextStops: PlanStop[] = Array.isArray(data.stops) ? data.stops : [];
      if (nextStops.length) {
        setStops(nextStops);
      }
      setInfoMessage(data?.note || `Tweaked that stop for ${mood}.`);
    } catch (err: any) {
      setInfoMessage(err?.message || 'Sorry, we could not replan that stop right now.');
    } finally {
      setActivityReplanLoading(null);
    }
  };

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    setError(null);
    setInfoMessage(null);
    setActivityMenuOpen(null);
    setActivityReplanLoading(null);
    setDayReplanLoading(true);
    setStops(null);
    const requestBody = { ...payload, refreshToken: refreshKey };

    (async () => {
      try {
        const res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        const out: PlanStop[] = Array.isArray(data) ? data : (data.stops ?? []);
        if (!cancelled) {
          setStops(out);
          setDayReplanLoading(false);
          if (lastActionRef.current === 'full-day') {
            setInfoMessage('Fresh itinerary coming right up — enjoy the new flow!');
            lastActionRef.current = null;
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setDayReplanLoading(false);
          setError(e?.message || 'Failed to build itinerary.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [payload, refreshKey]);

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-4 text-red-700 shadow-sm">
          Error: {error}
        </div>
      </div>
    );
  }
  if (!stops) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <div className="rounded-2xl border border-blue-100 bg-blue-50/80 px-6 py-4 text-blue-700 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🍳</span>
            <div>
              <p className="text-lg font-semibold">Cooking up your perfect day…</p>
              <p className="text-sm text-blue-600/80 animate-pulse">Simmering in the best spots right now.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isDayButtonDisabled = dayReplanLoading || activityReplanLoading !== null || !payload;
  const replanButtonLabel = dayReplanLoading ? 'Replanning…' : 'Replan my day';

  let activityCounter = -1;

  return (
    <div className="mx-auto max-w-2xl px-6 pb-12 pt-8 space-y-4">
      {payload && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm">
          <details className="w-full max-w-md text-sm text-slate-600">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-transparent px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 transition hover:border-slate-200 hover:bg-slate-50">
              <span>Plan inputs</span>
              <span className="text-[11px] font-medium text-slate-400">
                {payload.city} • {payload.date}
              </span>
            </summary>
            <div className="mt-3 space-y-3 rounded-lg border border-slate-100 bg-white px-3 py-3">
              {payload.vibes.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Vibes</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {payload.vibes.map((vibe) => (
                      <span
                        key={vibe}
                        className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"
                      >
                        {vibe.charAt(0).toUpperCase() + vibe.slice(1)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Pace</div>
                <div className="mt-1 text-sm font-medium capitalize text-slate-700">
                  {payload.pace}
                </div>
              </div>
              {payload.focusArea && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Focus Area</div>
                  <div className="mt-1 text-sm font-medium text-slate-700">
                    {areaLabelForValue(payload.focusArea)}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Must-dos</div>
                {mustDoSummaries.length > 0 ? (
                  <ul className="mt-1 space-y-1 text-sm">
                    {mustDoSummaries.map((item, idx) => (
                      <li key={`${item}-${idx}`} className="flex items-start gap-2 text-slate-600">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">None added yet.</p>
                )}
              </div>
            </div>
          </details>
          <button
            type="button"
            onClick={handleReplanDay}
            disabled={isDayButtonDisabled}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              isDayButtonDisabled
                ? 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400'
                : 'border border-slate-800 text-slate-800 hover:bg-slate-900 hover:text-white'
            }`}
          >
            {replanButtonLabel}
          </button>
        </div>
      )}

      {infoMessage && (
        <div className="rounded-lg border border-blue-100 bg-blue-50/80 px-4 py-2 text-sm text-blue-700 shadow-sm">
          {infoMessage}
        </div>
      )}

      {stops.map((s, i) => {
        const isTransit = s.title === 'Transit';
        if (isTransit) {
          return (
            <div
              key={`transit-${i}`}
              className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-3 text-sm text-slate-600 shadow-inner"
            >
              <div className="flex items-center gap-2 text-slate-500">
                <span className="text-xs font-semibold uppercase tracking-wide">Transit</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span className="text-xs text-slate-400">Connection</span>
              </div>
              <p className="mt-1 text-sm font-medium text-slate-700">{s.description ?? 'Travel to the next stop'}</p>
            </div>
          );
        }

        activityCounter += 1;
        const activityIndex = activityCounter;
        const menuOpen = activityMenuOpen === activityIndex;
        const isActivityLoading = activityReplanLoading === activityIndex;
        const disableActivity = dayReplanLoading || activityReplanLoading !== null;

        return (
          <div key={`stop-${i}`} className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm transition hover:shadow-md">
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
            {s.description && <p className="mt-2 text-sm text-slate-600">{s.description}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a
                href={buildMapsUrl(s)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-blue-600 px-4 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 transition"
              >
                <span role="img" aria-hidden="true">🗺️</span>
                <span>Open in Maps</span>
              </a>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (disableActivity) return;
                    setActivityMenuOpen(menuOpen ? null : activityIndex);
                  }}
                  disabled={disableActivity}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    disableActivity
                      ? 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400'
                      : 'border border-slate-400 text-slate-600 hover:border-slate-600 hover:text-slate-800'
                  }`}
                >
                  {isActivityLoading ? 'Replanning…' : 'Replan'}
                </button>
                {menuOpen && (
                  <div className="absolute right-0 z-10 mt-2 w-48 rounded-xl border border-slate-200 bg-white shadow-lg">
                    {STOP_REPLAN_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => handleStopReplan(activityIndex, option)}
                        className="block w-full px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
