'use client';
import { useEffect, useState } from 'react';
import { loadDraft, saveDraft } from '@/lib/draft';
import type { TripDraft } from '@/lib/types';
import { useRouter } from 'next/navigation';

export default function Setup() {
  const router = useRouter();
  const [city, setCity]   = useState('New York City');
  const [date, setDate]   = useState('2025-10-12');
  const [vibes, setVibes] = useState<string[]>([]);
  const [pace, setPace]   = useState<'chill'|'balanced'|'max'>('balanced');

  useEffect(() => {
    const d = loadDraft();
    if (d) { setCity(d.city); setDate(d.date); setVibes(d.vibes); setPace(d.pace); }
  }, []);

  const options = [
    { id:'foodie', label:'Food & Drink', emoji:'🍽️' },
    { id:'culture', label:'Culture / Museums', emoji:'🖼️' },
    { id:'outdoors', label:'Outdoors', emoji:'🌿' },
    { id:'shopping', label:'Shopping', emoji:'🛍️' },
    { id:'nightlife', label:'Nightlife', emoji:'🎉' },
    { id:'explore', label:'Explore', emoji:'🗺️' },
    { id:'chill', label:'Chill', emoji:'🧘' },
  ];

  const toggle = (id: string) =>
    setVibes(v => v.includes(id) ? v.filter(x=>x!==id) : [...v, id]);

  const next = () => {
    const draft: TripDraft = { city, date, vibes, pace };
    saveDraft(draft);
    router.push('/must-dos');
  };

  return (
    <main className="container py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Let&apos;s plan your perfect NYC day</h1>
        <p className="text-slate-600">Pick your vibes. We&apos;ll do the rest.</p>
      </header>

      <section className="mb-4">
        <label className="block text-sm font-medium mb-1">Destination</label>
        <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
               value={city} onChange={e=>setCity(e.target.value)} placeholder="City" />
      </section>

      <section className="mb-6">
        <label className="block text-sm font-medium mb-1">Date</label>
        <input type="date" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
               value={date} onChange={e=>setDate(e.target.value)} />
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Vibes (select at least one)</h2>
        <div className="flex flex-wrap gap-2">
          {options.map(o => (
            <button key={o.id} type="button" onClick={()=>toggle(o.id)}
              className={`pill ${vibes.includes(o.id) ? 'pill-active' : ''}`}>
              <span className="mr-1">{o.emoji}</span>{o.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Pace</h2>
        <div className="grid grid-cols-3 gap-2">
          {(['chill','balanced','max'] as const).map(p => (
            <button key={p} type="button" onClick={()=>setPace(p)}
              className={`rounded-2xl border px-3 py-3 bg-white ${
                pace===p ? 'pill-active':'border-slate-300 hover:border-slate-400'}`}>
              <div className="text-sm font-medium">
                {p==='chill'?'Super Chill': p==='balanced'?'Balanced':'See It All'}
              </div>
            </button>
          ))}
        </div>
      </section>

      <button
        disabled={vibes.length===0}
        onClick={next}
        className="btn btn-primary disabled:bg-slate-300"
        type="button"
      >
        Continue
      </button>
    </main>
  );
}
