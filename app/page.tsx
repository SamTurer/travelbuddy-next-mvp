'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { saveDraft } from '@/lib/draft';
import { TripDraft } from '@/lib/types';

export default function Home() {
  const router = useRouter();

  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  const [vibes, setVibes] = useState<string[]>([]);
  const [pace, setPace] = useState<'chill' | 'balanced' | 'max'>('balanced');

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

    const draft: TripDraft = {
      city,
      date,
      vibes,
      pace,
      mustDos: [],
    };

    saveDraft(draft);
    router.push('/must-dos');
  };

  return (
    <main className="container py-10 max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold mb-6 text-center">🗽 Plan Your Perfect Day 🧭</h1>
      <p className="text-lg text-center mb-10 text-slate-600">
        Tell us a little about your trip and we’ll build the ideal itinerary for you.
      </p>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* City */}
        <div>
          <label className="block text-lg font-semibold mb-2">🌆 City</label>
          <input
            type="text"
            placeholder="e.g., New York City"
            className="w-full border rounded-lg px-4 py-2 text-lg"
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
            className="w-full border rounded-lg px-4 py-2 text-lg"
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
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
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

        {/* Pace */}
        <div>
          <label className="block text-lg font-semibold mb-4">⚡ Pace</label>
          <div className="flex gap-4">
            {[
              { label: '😎 Chill', value: 'chill' },
              { label: '⚖️ Balanced', value: 'balanced' },
              { label: '🏃‍♂️ Max Exploration', value: 'max' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPace(option.value as 'chill' | 'balanced' | 'max')}
                className={`px-4 py-2 rounded-full border text-lg transition ${
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

        <div className="pt-6 text-center">
          <button
            type="submit"
            className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white text-xl rounded-lg shadow"
          >
            Next →
          </button>
        </div>
      </form>
    </main>
  );
}
