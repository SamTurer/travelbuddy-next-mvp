import { TripDraft } from './types';

const STORAGE_KEY = 'trip-draft';

/** Save the current trip draft to localStorage */
export function saveDraft(draft: TripDraft) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }
}

/** Load a previously saved trip draft from localStorage */
export function loadDraft(): TripDraft | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}
