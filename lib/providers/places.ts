/**
 * The default planner does not invent places.
 * Optional Grok suggestions are requested only when XAI_SUGGESTIONS=true,
 * and they are labeled source "ai" on the itinerary. They are never merged
 * into data/nyc-places.json.
 */

export type ProviderPlace = {
  name: string;
  category?: string;
  neighborhood?: string;
  description?: string;
  lat?: number;
  lng?: number;
  source: 'ai';
};

export async function fetchExtraPlaces(): Promise<ProviderPlace[]> {
  return [];
}
