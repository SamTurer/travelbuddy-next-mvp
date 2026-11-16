// app/plan/PlanClient.tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadDraft, saveDraft } from '@/lib/draft';
import { loadLastItinerary, saveLastItinerary } from '@/lib/last-itinerary';
import { requestBrowserLocation } from '@/lib/device-location';
import MapsLink from '@/app/components/MapsLink';
import type { TripDraft } from '@/lib/types';
import { areaLabelForValue, coerceManhattanFocus } from '@/lib/areas';
import BookingTag from '@/app/components/BookingTag';
import RecommendedBy from '@/app/components/RecommendedBy';
import UnderstoodMatch from '@/app/components/UnderstoodMatch';
import DayMap from '@/app/components/DayMap';
import PlaceSheet from '@/app/components/PlaceSheet';
import type { BookingKind } from '@/lib/booking';
import type { RecommendedByPerson } from '@/lib/recommenders';

type PlanStop = {
  time: string;
  title: string;
  location: string;
  address?: string | null;
  description?: string;
  url?: string;
  kind?: 'place' | 'transit' | 'free';
  source?: 'curated' | 'must-do' | 'free' | 'ai';
  recommendedBy?: RecommendedByPerson[];
  note?: string;
  booking?: BookingKind;
  bookingNote?: string;
  bookingUrl?: string;
  mapsUrl?: string;
  warning?: string;
  mustDo?: boolean;
  understood?: { title: string; neighborhood: string };
  lat?: number;
  lng?: number;
  leg?: { mode?: 'walk' | 'transit' | string; summary?: string; mapsUrl?: string; minutes?: number } | null;
};

type BookAheadItem = {
  title: string;
  time: string;
  booking: BookingKind;
  bookingLabel: string;
  bookingNote?: string;
  bookingUrl?: string;
};

function localISODate(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

type Pace = 'chill' | 'balanced' | 'max';

type PlanPayload = {
  city: string;
  date: string;
  vibes: string[];
  pace: Pace;
  focusArea: string | null;
  locks: unknown[];
  startLocation?: { lat: number; lng: number; label?: string } | null;
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
  const [openPlace, setOpenPlace] = useState<PlanStop | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dayMapsUrl, setDayMapsUrl] = useState<string | null>(null);
  const [bookAhead, setBookAhead] = useState<BookAheadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TripDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dayReplanLoading, setDayReplanLoading] = useState(false);
  const [activityMenuOpen, setActivityMenuOpen] = useState<number | null>(null);
  const [activityReplanLoading, setActivityReplanLoading] = useState<number | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
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
      searchParams.get('date') ?? draft?.date ?? localISODate();
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
      focusArea = coerceManhattanFocus(focusParam);
    } else if (draft?.focusArea) {
      focusArea = coerceManhattanFocus(draft.focusArea);
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

    return {
      city,
      date,
      vibes,
      pace: normalizedPace,
      focusArea,
      locks,
      startLocation: draft?.startLocation ?? null,
    };
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
      const nextWarnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
      if (nextStops.length) {
        setStops(nextStops);
        setWarnings(nextWarnings);
        setDayMapsUrl(typeof data.mapsUrl === 'string' ? data.mapsUrl : null);
        setBookAhead(Array.isArray(data.bookAhead) ? data.bookAhead : []);
      }
      setInfoMessage(nextWarnings.length ? null : (data?.note || `Tweaked that stop for ${mood}.`));
      if (nextStops.length && payload) {
        saveLastItinerary({
          savedAt: new Date().toISOString(),
          date: payload.date,
          city: payload.city,
          stops: nextStops,
          warnings: nextWarnings,
          mapsUrl: typeof data.mapsUrl === 'string' ? data.mapsUrl : null,
          bookAhead: Array.isArray(data.bookAhead) ? data.bookAhead : [],
        });
      }
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
    const cached = loadLastItinerary();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!(offline && cached)) setStops(null);
    const requestBody = { ...payload, refreshToken: refreshKey };

    const showCached = (note: string) => {
      if (!cached) return false;
      setStops(cached.stops as PlanStop[]);
      setWarnings(cached.warnings ?? []);
      setDayMapsUrl(cached.mapsUrl);
      setBookAhead((cached.bookAhead ?? []) as BookAheadItem[]);
      setOfflineNote(note);
      setError(null);
      setDayReplanLoading(false);
      return true;
    };

    if (offline && cached) {
      showCached(`Offline. Showing the day saved for ${cached.date}.`);
      return;
    }

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
          const nextWarnings = Array.isArray(data?.warnings) ? data.warnings : [];
          const nextMaps = typeof data?.mapsUrl === 'string' ? data.mapsUrl : null;
          const nextBook = Array.isArray(data?.bookAhead) ? data.bookAhead : [];
          setStops(out);
          setWarnings(nextWarnings);
          setDayMapsUrl(nextMaps);
          setBookAhead(nextBook);
          setOfflineNote(null);
          saveLastItinerary({
            savedAt: new Date().toISOString(),
            date: payload.date,
            city: payload.city,
            stops: out,
            warnings: nextWarnings,
            mapsUrl: nextMaps,
            bookAhead: nextBook,
          });
          setDayReplanLoading(false);
          if (lastActionRef.current === 'full-day') {
            setInfoMessage('Fresh itinerary coming right up — enjoy the new flow!');
            lastActionRef.current = null;
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setDayReplanLoading(false);
          if (!showCached('No signal. Showing the last day saved on this phone.')) {
            setError(e?.message || 'Failed to build itinerary.');
          }
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
          <div>
            <p className="font-serif text-2xl font-semibold">Building your day</p>
            <p className="mt-1 text-sm text-mute">Checking hours, neighborhoods, and the walk between them.</p>
          </div>
        </div>
      </div>
    );
  }

  const useMyLocation = async () => {
    setLocError(null);
    setLocBusy(true);
    try {
      const loc = await requestBrowserLocation();
      const next = { ...(draft || { city: payload?.city || 'New York City', date: payload?.date || localISODate(), vibes: payload?.vibes || [], pace: payload?.pace || 'balanced' }), startLocation: loc };
      saveDraft(next);
      setDraft(next);
    } catch (err: any) {
      setLocError(err?.message || 'Could not read your location.');
    } finally {
      setLocBusy(false);
    }
  };

  const isDayButtonDisabled = dayReplanLoading || activityReplanLoading !== null || !payload;
  const replanButtonLabel = dayReplanLoading ? 'Replanning…' : 'Replan my day';

  let activityCounter = -1;
  const mapPoints = stops
    .filter((stop) => stop.kind !== 'transit' && stop.kind !== 'free' && stop.lat != null && stop.lng != null)
    .map((stop) => ({ lat: stop.lat as number, lng: stop.lng as number, title: stop.title, mode: stop.leg?.mode }));
  const dayTitle = payload
    ? new Date(`${payload.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : 'Your day';
  const dayMeta = [
    payload?.focusArea ? areaLabelForValue(payload.focusArea) : null,
    payload?.vibes?.[0] ? payload.vibes[0][0].toUpperCase() + payload.vibes[0].slice(1) : null,
    payload?.pace ? payload.pace[0].toUpperCase() + payload.pace.slice(1) : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <div className="pb-8">
      <div className="relative">
        <DayMap points={mapPoints} />
        <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between gap-3 rounded-xl bg-white/90 px-3 py-2 shadow-md backdrop-blur">
          <div>
            <div className="font-serif text-[15px] font-semibold tracking-tight">{dayTitle}</div>
            {dayMeta ? <div className="text-[11px] text-mute">{dayMeta}</div> : null}
          </div>
          {dayMapsUrl ? (
            <MapsLink href={dayMapsUrl} className="shrink-0 text-[13px] font-semibold text-system">
              Open in Maps
            </MapsLink>
          ) : null}
        </div>
      </div>

      <div className="space-y-2.5 px-4 pt-3">
        {offlineNote && (
          <div className="rounded-xl bg-white px-4 py-3 text-sm text-ink">{offlineNote}</div>
        )}
        {infoMessage && <div className="rounded-xl bg-white px-4 py-2 text-sm text-system">{infoMessage}</div>}
        {warnings.length > 0 && (
          <div className="rounded-xl bg-white px-4 py-3 text-sm text-ink">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#C93400]">Heads up</div>
            <ul className="mt-1 space-y-1">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {stops.some((stop) => stop.understood) && (
          <div className="rounded-xl bg-white px-4 py-3">
            {stops
              .filter((stop) => stop.understood)
              .map((stop, idx) => (
                <UnderstoodMatch
                  key={`${stop.understood?.title}-${idx}`}
                  title={stop.understood?.title || stop.title}
                  neighborhood={stop.understood?.neighborhood}
                  time={stop.time?.split('–')[0]?.trim()}
                />
              ))}
          </div>
        )}

        <div className="overflow-hidden rounded-[14px] bg-white">
          {stops.map((s, i) => {
            const isTransit = s.title === 'Transit' || s.kind === 'transit';
            if (isTransit) {
              const directions = s.mapsUrl || s.url;
              const walk = s.leg?.mode === 'walk';
              return (
                <div key={`transit-${i}`} className="grid grid-cols-[54px_1fr] gap-x-2.5 bg-[#F9F9FB] px-3.5">
                  <div className="relative min-h-9">
                    <span className="absolute bottom-0 left-2 top-0 border-l-2 border-dashed border-[#C7C7CC]" />
                  </div>
                  <div className="flex items-start justify-between gap-2 py-2 text-xs text-[#6C6C70]">
                    <span>
                      <strong className="font-semibold text-ink">{walk ? 'Walk' : 'Subway'}</strong>
                      {s.description ? <span className="mt-0.5 block">{s.description}</span> : null}
                    </span>
                    {directions ? (
                      <MapsLink href={directions} className="shrink-0 font-medium text-system">
                        Open in Google Maps
                      </MapsLink>
                    ) : null}
                  </div>
                </div>
              );
            }

            activityCounter += 1;
            const activityIndex = activityCounter;
            const menuOpen = activityMenuOpen === activityIndex;
            const isActivityLoading = activityReplanLoading === activityIndex;
            const disableActivity = dayReplanLoading || activityReplanLoading !== null;
            const isFree = s.kind === 'free' || s.source === 'free';
            const start = s.time?.split('–')[0]?.trim();

            return (
              <div key={`stop-${i}`} className="grid grid-cols-[54px_1fr] gap-x-2.5 px-3.5 py-3">
                <div className="pt-0.5 text-[13px] font-semibold tabular-nums tracking-tight">
                  {start?.replace(/\s*(AM|PM)$/i, '')}
                </div>
                <div>
                  {isFree ? (
                    <div className="font-serif text-base font-semibold tracking-tight">{s.title}</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenPlace(s)}
                      className="text-left font-serif text-base font-semibold tracking-tight"
                    >
                      {s.title}
                    </button>
                  )}
                  <div className="mt-0.5 text-xs text-mute">
                    {[s.location, s.address].filter(Boolean).join('  ·  ')}
                  </div>
                  <RecommendedBy people={s.recommendedBy} />
                  {s.mustDo && s.understood ? (
                    <UnderstoodMatch
                      title={s.understood.title}
                      neighborhood={s.understood.neighborhood}
                      time={start}
                    />
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <BookingTag booking={s.booking} note={s.bookingNote} />
                    {s.source === 'ai' && (
                      <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800">
                        AI suggestion
                      </span>
                    )}
                    {(s.source === 'must-do' || s.mustDo) && (
                      <span className="rounded-md bg-[#007AFF14] px-1.5 py-0.5 text-[11px] font-medium text-system">
                        Must-do
                      </span>
                    )}
                  </div>
                  {s.note ? <p className="mt-1 text-xs text-ink">{s.note}</p> : null}
                  {s.warning ? <p className="mt-1 text-xs text-[#C93400]">{s.warning}</p> : null}
                  {!isFree && (
                    <div className="relative mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (disableActivity) return;
                          setActivityMenuOpen(menuOpen ? null : activityIndex);
                        }}
                        disabled={disableActivity}
                        className="text-xs font-semibold text-system disabled:text-mute"
                      >
                        {isActivityLoading ? 'Replanning…' : 'Replan'}
                      </button>
                      {menuOpen && (
                        <div className="absolute left-0 z-10 mt-1 w-48 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5">
                          {STOP_REPLAN_OPTIONS.map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => handleStopReplan(activityIndex, option)}
                              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-grouped"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {bookAhead.length > 0 && (
          <section className="rounded-[14px] bg-white px-3.5 py-3">
            <h2 className="mb-2 text-[13px] font-semibold">Book ahead</h2>
            <ul className="space-y-2">
              {bookAhead.map((item) => (
                <li key={`${item.title}-${item.time}`} className="flex gap-2.5">
                  <span className="mt-0.5 h-5 w-5 shrink-0 rounded-[5px] border-[1.5px] border-[#C7C7CC]" />
                  <div>
                    <div className="text-[15px] font-semibold tracking-tight">{item.title}</div>
                    <div className="text-xs text-mute">
                      {item.bookingLabel} · {item.time}
                    </div>
                    {item.bookingNote ? <div className="text-xs text-mute">{item.bookingNote}</div> : null}
                    {item.bookingUrl ? (
                      <a className="text-xs font-semibold text-system" href={item.bookingUrl} target="_blank" rel="noreferrer">
                        Reserve
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <button
          type="button"
          onClick={handleReplanDay}
          disabled={isDayButtonDisabled}
          className="tap w-full rounded-xl bg-white text-[17px] font-semibold text-system disabled:text-mute"
        >
          {replanButtonLabel}
        </button>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locBusy}
          className="tap w-full text-left text-base font-semibold text-system"
        >
          {locBusy ? 'Finding you…' : payload?.startLocation ? 'Update my location' : 'Use my location'}
        </button>
        {payload?.startLocation && (
          <p className="px-1 text-xs text-mute">First leg starts from where you are. Meal times stay put.</p>
        )}
        {locError && <p className="text-sm text-red-700">{locError}</p>}
      </div>

      {openPlace && <PlaceSheet place={openPlace} onClose={() => setOpenPlace(null)} />}
    </div>
  );
}
