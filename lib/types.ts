// lib/types.ts

export type Pace = 'chill' | 'balanced' | 'max';

export type MustDo =
  | string
  | {
      title: string;
      location?: string;
      description?: string;
      time?: string; // optional user-entered time hint
    };

export interface TripDraft {
  city: string;
  date: string;                // YYYY-MM-DD
  vibes: string[];
  pace: Pace;
  mustDos?: MustDo[];          // can be strings or objects
}

/**
 * One stop in the final itinerary.
 * `url` is optional but recommended; if missing, the UI/planner will
 * generate a Google Maps search link as a fallback.
 */
export interface Stop {
  time: string;       // e.g., "10:30 AM – 11:30 AM"
  title: string;      // e.g., "The Met"
  location: string;   // e.g., "Upper East Side"
  description: string;
  url?: string;       // e.g., "https://maps.app.goo.gl/..."
}
