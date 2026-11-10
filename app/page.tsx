'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { saveDraft } from '@/lib/draft';
import { TripDraft } from '@/lib/types';
import { AREA_OPTIONS, randomAreaValue } from '@/lib/areas';
import { requestBrowserLocation } from '@/lib/device-location';

export default function Home() {
  const router = useRouter();

  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  const [vibes, setVibes] = useState<string[]>([]);
  const [pace, setPace] = useState<'chill' | 'balanced' | 'max'>('balanced');
  const [focusAreaSelection, setFocusAreaSelection] = useState<string>('surprise');
  const [startLocation, setStartLocation] = useState<TripDraft['startLocation']>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [showInstallHint, setShowInstallHint] = useState(false);

  useEffect(() => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (ios && !standalone && !localStorage.getItem('tb-hide-install-hint')) setShowInstallHint(true);
  }, []);

  const toggleVibe = (vibe: string) => {
    setVibes((prev) =>
      prev.includes(vibe) ? prev.filter((v) => v !== vibe) : [...prev, vibe]
    );
  };

  const vibeOptions = [
    {
      id: 'classic',
      title: 'Classic',
      blurb: 'Iconic, with a local twist',
    },
    {
      id: 'curator',
      title: 'Curator',
      blurb: 'Art and design',
    },
    {
      id: 'local',
      title: 'Local',
      blurb: 'Character, less obvious',
    },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let resolvedArea: string | null;
    if (focusAreaSelection === 'surprise') {
      resolvedArea = randomAreaValue();
    } else if (focusAreaSelection === 'any') {
      resolvedArea = null;
    } else {
      resolvedArea = focusAreaSelection;
    }

    const draft: TripDraft = {
      city,
      date,
      vibes,
      pace,
      focusArea: resolvedArea,
      mustDos: [],
      startLocation: startLocation ?? null,
    };

    saveDraft(draft);
    router.push('/must-dos');
  };

  return (
    <main className="px-5 pb-8 pt-2">
      {showInstallHint && (
        <div className="mb-4 rounded-xl bg-white px-4 py-3 text-[15px] text-ink">
          <p>
            On your iPhone, tap Share, then <strong>Add to Home Screen</strong>. It opens full screen, like an app.
          </p>
          <button
            type="button"
            className="tap mt-1 text-base font-semibold text-system"
            onClick={() => {
              localStorage.setItem('tb-hide-install-hint', '1');
              setShowInstallHint(false);
            }}
          >
            Got it
          </button>
        </div>
      )}
      <h1 className="font-serif text-[32px] font-semibold leading-none tracking-tight">Plan your day</h1>
      <p className="mt-1.5 text-[15px] text-mute">A New York day from Sam and Kailey&apos;s list.</p>

      <form onSubmit={handleSubmit}>
        <div className="mt-4 overflow-hidden rounded-xl bg-white">
          <label className="flex min-h-11 items-center justify-between gap-3 px-4">
            <span className="text-[17px]">City</span>
            <input
              type="text"
              placeholder="New York City"
              className="field"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
            />
          </label>
          <label className="relative flex min-h-11 items-center justify-between gap-3 px-4 before:absolute before:left-4 before:right-0 before:top-0 before:h-px before:bg-[#C6C6C8]">
            <span className="text-[17px]">Date</span>
            <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="relative flex min-h-11 items-center justify-between gap-3 px-4 before:absolute before:left-4 before:right-0 before:top-0 before:h-px before:bg-[#C6C6C8]">
            <span className="text-[17px]">Area</span>
            <select
              value={focusAreaSelection}
              onChange={(e) => setFocusAreaSelection(e.target.value)}
              className="field max-w-[60%]"
            >
              {AREA_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="sec-label">Vibe</div>
        <div className="flex gap-2">
          {vibeOptions.map((option) => {
            const active = vibes.includes(option.id);
            return (
              <button
                type="button"
                key={option.id}
                onClick={() => toggleVibe(option.id)}
                className={`min-h-0 flex-1 rounded-xl px-2.5 py-3 text-left ${active ? 'bg-system text-white' : 'bg-white'}`}
              >
                <div className="text-[15px] font-semibold tracking-tight">{option.title}</div>
                <p className={`mt-0.5 text-[11px] leading-snug ${active ? 'text-white/90' : 'text-mute'}`}>{option.blurb}</p>
              </button>
            );
          })}
        </div>

        <div className="sec-label">Pace</div>
        <div className="flex rounded-[9px] bg-[#78788022] p-0.5">
          {[
            { label: 'Chill', value: 'chill' },
            { label: 'Balanced', value: 'balanced' },
            { label: 'Max', value: 'max' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPace(option.value as 'chill' | 'balanced' | 'max')}
              className={`h-8 flex-1 rounded-md text-[13px] font-semibold ${
                pace === option.value ? 'bg-white text-ink shadow-sm' : 'text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={async () => {
            setLocError(null);
            setLocBusy(true);
            try {
              setStartLocation(await requestBrowserLocation());
            } catch (err: any) {
              setLocError(err?.message || 'Could not read your location.');
            } finally {
              setLocBusy(false);
            }
          }}
          className="tap mt-4 w-full text-left text-base font-medium text-system"
        >
          {locBusy ? 'Finding you…' : startLocation ? 'Location saved for the first leg' : 'Use my location'}
        </button>
        {locError && <p className="mt-1 text-sm text-red-700">{locError}</p>}

        <button type="submit" className="tap mt-4 w-full rounded-xl bg-system text-[17px] font-semibold text-white">
          Continue
        </button>
      </form>
    </main>
  );
}
