'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadDraft, saveDraft } from '@/lib/draft';
import type { TripDraft } from '@/lib/types';
import UnderstoodMatch from '@/app/components/UnderstoodMatch';

export default function MustDosPage() {
  const router = useRouter();

  const [draft, setDraft] = useState<TripDraft | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Preview state
  const [preview, setPreview] = useState<
    Array<{ title: string; time?: string; location?: string; detail?: string; category?: string; duration_min?: number; url?: string; matched?: boolean }>
  >([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const d = loadDraft();
      setDraft(d);
    } catch (e: any) {
      setError(e?.message || 'Could not load your draft.');
    }
  }, []);

  function addMustDo() {
    if (!input.trim()) return;
    const next = { ...(draft || ({} as TripDraft)) };
    next.mustDos = [...(next.mustDos || []), input.trim()];
    setDraft(next);
    saveDraft(next);
    setInput('');
    setPreview([]); // clear old preview
  }

  function removeMustDo(idx: number) {
    if (!draft) return;
    const next = { ...draft };
    next.mustDos = (next.mustDos || []).filter((_, i) => i !== idx);
    setDraft(next);
    saveDraft(next);
    setPreview([]); // clear old preview
  }

  async function previewUnderstanding() {
    try {
      setPreviewLoading(true);
      setPreviewError(null);
      const payload = {
        city: draft?.city || 'New York City',
        date: draft?.date || new Date().toISOString().slice(0, 10),
        vibes: draft?.vibes || [],
        locks: draft?.mustDos || [],
      };
      const res = await fetch('/api/enrich-locks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Preview failed (${res.status})`);
      }
      const data = await res.json();
      setPreview(data?.locks || []);
    } catch (e: any) {
      setPreviewError(e?.message || 'Could not preview.');
    } finally {
      setPreviewLoading(false);
    }
  }

  function toPlan() {
    router.push('/plan');
  }

  if (error) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold mb-6">Must-dos</h1>
        <p className="text-red-600">❌ {error}</p>
      </main>
    );
  }

  return (
    <main className="px-5 pb-8 pt-2">
      <h1 className="font-serif text-[32px] font-semibold leading-none tracking-tight">Must-dos</h1>
      <p className="mt-1.5 text-[15px] text-mute">A time or a nickname is enough. No API key required.</p>

      <div className="sec-label">Add one</div>
      <div className="overflow-hidden rounded-xl bg-white">
        <div className="flex items-center gap-2 px-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Met Museum at noon"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none"
          />
          <button type="button" onClick={addMustDo} className="tap shrink-0 text-base font-semibold text-system">
            Add
          </button>
        </div>
        {(draft?.mustDos?.length ?? 0) === 0 ? (
          <p className="border-t border-[#C6C6C8]/70 px-4 py-3 text-sm text-mute">No must-dos yet.</p>
        ) : (
          draft!.mustDos!.map((m, i) => (
            <div key={typeof m === 'string' ? `${m}-${i}` : `${m.title}-${i}`} className="flex items-center gap-2 border-t border-[#C6C6C8]/70 px-4 py-2.5">
              <span className="flex-1 text-base font-semibold tracking-tight">
                {typeof m === 'string' ? m : [m.title, m.time, m.location].filter(Boolean).join(' · ')}
              </span>
              <button type="button" onClick={() => removeMustDo(i)} className="tap text-2xl font-light text-[#C7C7CC]" aria-label="Remove">
                ×
              </button>
            </div>
          ))
        )}
      </div>
      <p className="mt-2 px-1 text-xs leading-snug text-mute">
        Include a time or neighborhood, e.g. &ldquo;Met Museum at noon.&rdquo;
      </p>

      <button
        type="button"
        onClick={previewUnderstanding}
        className="tap mt-4 w-full rounded-xl bg-[#78788014] text-base font-semibold text-system"
        disabled={previewLoading}
      >
        {previewLoading ? 'Parsing…' : 'Preview understanding'}
      </button>
      <button type="button" onClick={toPlan} className="tap mt-2 w-full rounded-xl bg-system text-[17px] font-semibold text-white">
        Build my day
      </button>

      <section className="mt-5 rounded-[14px] bg-white px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold">What we understood</h2>
          <span className="text-[11px] text-mute">No AI key needed</span>
        </div>
        {previewError && <p className="mt-2 text-sm text-red-600">{previewError}</p>}
        {preview.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {preview.map((p, i) => (
              <li key={i}>
                {p.matched ? (
                  <UnderstoodMatch title={p.title} neighborhood={p.location} time={p.time} detail={p.detail} />
                ) : (
                  <span className="text-sm">Kept as typed: {p.title}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          !previewLoading &&
          !previewError && <p className="mt-2 text-xs text-mute">Preview to see the place and neighborhood we matched.</p>
        )}
      </section>
    </main>
  );
}
