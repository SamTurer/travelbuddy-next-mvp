/** Server-side xAI Grok client. No-ops when XAI_API_KEY is unset. */

export const DEFAULT_XAI_MODEL = 'grok-4.7';

export function xaiModel(): string {
  const configured = process.env.XAI_MODEL?.trim();
  return configured || DEFAULT_XAI_MODEL;
}

export function xaiEnabled(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function grokComplete(
  messages: ChatMessage[],
  options?: { temperature?: number; timeoutMs?: number }
): Promise<string | null> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) return null;
  const timeoutMs = options?.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: xaiModel(),
        temperature: options?.temperature ?? 0.2,
        messages,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart === -1 || arrayEnd <= arrayStart) throw new Error('no json');
    return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
  }
  return JSON.parse(text.slice(start, end + 1));
}
