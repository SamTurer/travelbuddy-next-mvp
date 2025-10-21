import OpenAI from "openai";

type PlanStop = { time: string; title: string; location: string; description: string };

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * formatTimelineWithLLM
 * Given raw stops, ask the LLM to lightly polish the copy and ensure friendly tone.
 * This keeps hard constraints server-side while still benefiting from LLM quality.
 */
export async function formatTimelineWithLLM(stops: PlanStop[], context: { city: string; vibes: string[]; pace: string }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return stops; // graceful fallback if not configured
  const client = new OpenAI({ apiKey });

  const sys = `You are TravelBuddy, a concise and friendly city trip planner.
You must preserve the order and times exactly as provided.
Rewrite each stop's title/location/description to be clear, upbeat, and human, but do not invent places or times.`;

  const user = JSON.stringify({ city: context.city, pace: context.pace, vibes: context.vibes, stops }, null, 2);

  const timeoutMs = Number(process.env.PLAN_LLM_TIMEOUT_MS ?? 6000);

  const completionPromise = client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: `Polish the following timeline JSON and return JSON with the same structure: ${user}` }
    ],
    temperature: 0.5,
  });

  const timeoutGuard =
    timeoutMs > 0
      ? new Promise<null>((_, reject) => {
          setTimeout(() => reject(new Error('plan_llm_timeout')), timeoutMs);
        })
      : null;

  let completion: Awaited<typeof completionPromise>;
  try {
    completion = (await (timeoutGuard ? Promise.race([completionPromise, timeoutGuard]) : completionPromise)) as Awaited<
      typeof completionPromise
    >;
  } catch {
    return stops;
  }

  const text = completion.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as PlanStop[];
    if (Array.isArray(parsed?.stops)) return parsed.stops as PlanStop[];
    return stops;
  } catch {
    return stops;
  }
}

/**
 * NOTE: If/when switching to Gemini:
 * - Replace this file with a Google Generative AI client.
 * - Mirror the same function signature so the API routes don’t need changes.
 */
