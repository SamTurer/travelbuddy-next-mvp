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
      blurb: 'Iconic spots with a local twist.',
    },
    {
      id: 'curator',
      title: 'Curator',
      blurb: "Art, design, and the city's bold ideas.",
    },
    {
      id: 'local',
      title: 'Local',
      blurb: 'Off the beaten path and full of character.',
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
    <main className="px-4 py-6">
      {showInstallHint && (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-700">
          <p>On your iPhone, tap Share, then <strong>Add to Home Screen</strong>. It opens full screen, like an app.</p>
          <button
            type="button"
            className="tap mt-2 text-base font-semibold text-slate-900"
            onClick={() => {
              localStorage.setItem('tb-hide-install-hint', '1');
              setShowInstallHint(false);
            }}
          >
            Got it
          </button>
        </div>
      )}
      <h1 className="mb-2 text-center text-3xl font-bold leading-tight">Plan your day</h1>
      <p className="mb-6 text-center text-base text-slate-600">
        A New York day from Sam and Kailey&apos;s list.
      </p>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* City */}
        <div>
          <label className="block text-lg font-semibold mb-2">🌆 City</label>
          <input
            type="text"
            placeholder="e.g., New York City"
            className="field"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
          />
        </div>

        {/* Date */}
        <div>
          <label className="block text-lg font-semibold mb-2">📅 Date</label>
          <input
            type="date"
            className="field"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>

        {/* Vibes */}
        <div>
          <label className="block text-lg font-semibold mb-4">✨ Vibes</label>
          <div className="grid gap-3">
            {vibeOptions.map((option) => {
              const active = vibes.includes(option.id);
              return (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => toggleVibe(option.id)}
                  className={`tap w-full rounded-2xl border px-4 py-4 text-left transition ${
                    active
                      ? 'border-blue-600 bg-blue-50 shadow-sm'
                      : 'border-slate-300 hover:border-slate-400 bg-white'
                  }`}
                >
                  <div className="text-xl font-semibold">{option.title}</div>
                  <p className="mt-1 text-base text-slate-600">{option.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Focus area */}
        <div>
          <label className="block text-lg font-semibold mb-2">📍 Area of town</label>
          <select
            value={focusAreaSelection}
            onChange={(e) => setFocusAreaSelection(e.target.value)}
            className="field"
          >
            {AREA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-sm text-slate-500">
            Choose a neighborhood focus or pick <em>Surprise me</em> for a random adventure.
          </p>
        </div>

        {/* Pace */}
        <div>
          <label className="block text-lg font-semibold mb-4">⚡ Pace</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '😎 Chill', value: 'chill' },
              { label: '⚖️ Balanced', value: 'balanced' },
              { label: '🏃‍♂️ Max Exploration', value: 'max' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPace(option.value as 'chill' | 'balanced' | 'max')}
                className={`tap rounded-2xl border px-2 text-base font-semibold transition ${
                  pace === option.value
                    ? 'bg-green-600 text-white border-green-600'
                    : 'border-slate-400 text-slate-700 bg-white hover:bg-slate-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
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
            className="tap w-full rounded-2xl border border-slate-300 bg-white px-4 text-base font-semibold text-slate-800"
          >
            {locBusy ? 'Finding you…' : startLocation ? 'Location saved for the first leg' : 'Use my location'}
          </button>
          {locError && <p className="mt-2 text-sm text-red-700">{locError}</p>}
        </div>

        <div className="pt-2">
          <button
            type="submit"
            className="tap w-full rounded-2xl bg-green-600 text-xl font-semibold text-white shadow"
          >
            Next
          </button>
        </div>
      </form>
    </main>
  );
}
