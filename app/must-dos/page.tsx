'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadDraft, saveDraft } from '@/lib/draft';
import type { TripDraft } from '@/lib/types';

export default function MustDosPage() {
  const router = useRouter();

  const [draft, setDraft] = useState<TripDraft | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Preview state
  const [preview, setPreview] = useState<
    Array<{ title: string; time?: string; location?: string; category?: string; duration_min?: number; url?: string }>
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
    <main className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold mb-6">Must-dos</h1>

      <section className="rounded-2xl border p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium">Add a must-do</label>
          <div className="mt-2 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='e.g., "Celeste UWS 7pm"'
              className="w-full rounded-lg border px-3 py-2"
            />
            <button onClick={addMustDo} className="rounded-lg border px-4 py-2">
              Add
            </button>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            You can include time and neighborhood, e.g., "Lilia Williamsburg 8:30pm" or "The Met afternoon".
          </p>
        </div>

        <div>
          <h2 className="font-medium mb-2">Your list</h2>
          {(draft?.mustDos?.length ?? 0) === 0 ? (
            <p className="text-sm text-neutral-500">No must-dos yet.</p>
          ) : (
            <ul className="space-y-2">
              {draft!.mustDos!.map((m, i) => (
                <li key={typeof m === 'string' ? `${m}-${i}` : `${m.title}-${i}`} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-sm">
                    {typeof m === 'string'
                      ? m
                      : [m.title, m.time, m.location].filter(Boolean).join(' • ')}
                  </span>
                  <button
                    onClick={() => removeMustDo(i)}
                    className="text-xs rounded-md border px-2 py-1"
                  >
                    Remove
                  </button>
                </li>

              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={previewUnderstanding}
            className="rounded-lg border px-4 py-2"
            disabled={previewLoading}
          >
            {previewLoading ? 'Parsing…' : 'Preview understanding'}
          </button>
          <button
            onClick={toPlan}
            className="rounded-lg bg-black text-white px-4 py-2"
          >
            Generate plan
          </button>
        </div>
      </section>

      {/* Preview Panel */}
      <section className="mt-6 rounded-2xl border p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">What we understood</h3>
          <span className="text-xs text-neutral-500">AI-enriched</span>
        </div>

        {previewError && <p className="mt-2 text-sm text-red-600">❌ {previewError}</p>}

        {preview.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {preview.map((p, i) => (
              <li key={i} className="rounded-full border px-3 py-1 text-sm">
                <strong>{p.title}</strong>
                {p.time && <> • {p.time}</>}
                {p.category && <> • {p.category}</>}
                {p.location && <> • {p.location}</>}
                {typeof p.duration_min === 'number' && <> • {p.duration_min}m</>}
              </li>
            ))}
          </ul>
        ) : (
          !previewLoading &&
          !previewError && (
            <p className="mt-2 text-xs text-neutral-500">
              Click <em>Preview understanding</em> to see how we’ll interpret your must-dos.
            </p>
          )
        )}
      </section>
    </main>
  );
}
