import { grokComplete, parseJsonObject, xaiEnabled } from './grok';

type PlanStop = { time: string; title: string; location: string; description: string };

/**
 * Optional copy polish. Off unless XAI_POLISH=true and XAI_API_KEY is set.
 * Titles, order, and times are kept. Only descriptions may change.
 */
export async function formatTimelineWithLLM(
  stops: PlanStop[],
  context: { city: string; vibes: string[]; pace: string }
): Promise<PlanStop[]> {
  if (process.env.XAI_POLISH !== 'true' || !xaiEnabled()) return stops;
  const text = await grokComplete(
    [
      {
        role: 'system',
        content:
          'Rewrite each description to be warm and concrete. Return JSON {"descriptions": string[]} with the same length. Do not change titles, order, or times, and do not invent places.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          city: context.city,
          pace: context.pace,
          vibes: context.vibes,
          descriptions: stops.map((stop) => stop.description),
        }),
      },
    ],
    { temperature: 0.4, timeoutMs: 8000 }
  );
  if (!text) return stops;
  try {
    const descriptions = (parseJsonObject(text) as { descriptions?: string[] }).descriptions;
    if (!descriptions || descriptions.length !== stops.length) return stops;
    return stops.map((stop, index) => ({
      ...stop,
      description: descriptions[index]?.trim() || stop.description,
    }));
  } catch {
    return stops;
  }
}
