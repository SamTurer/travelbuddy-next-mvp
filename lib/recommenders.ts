import rawRecommenders from '../data/recommenders.json';

/** A friend is a person. Publications are cited by their title. */
export type RecommenderKind = 'person' | 'publication' | 'friend';

export type Recommender = {
  id: string;
  displayName: string;
  /** Short bio / why this source is trustworthy for these kinds of places. */
  bio: string;
  type?: RecommenderKind;
  /** Public page for a publication, or a personal link. Optional. */
  url?: string | null;
  link?: string;
  avatar?: string;
  specialties?: string[];
};

export type RecommendationRef = {
  recommenderId: string;
  /** Optional quote from this person about this specific place. */
  note?: string;
};

export type RecommendedByPerson = {
  id: string;
  displayName: string;
  note?: string;
  type?: RecommenderKind;
  url?: string | null;
};

export function isPublication(person: { type?: RecommenderKind }): boolean {
  return person.type === 'publication';
}

export const recommenders = rawRecommenders as Recommender[];

const byId = new Map(recommenders.map((person) => [person.id, person]));

export function getRecommenders(): Recommender[] {
  return recommenders;
}

export function getRecommender(id: string): Recommender | undefined {
  return byId.get(id);
}

export function formatRecommendedBy(people: { displayName: string; type?: RecommenderKind }[]): string {
  const names = people.map((person) => person.displayName).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  // Publication titles read as a citation list. People still join with &.
  if (people.some((person) => person.type === 'publication')) return names.join(', ');
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function resolveRecommendations(refs: RecommendationRef[] | undefined): RecommendedByPerson[] {
  return (refs ?? []).map((ref) => {
    const person = getRecommender(ref.recommenderId);
    const url = person?.url || person?.link || undefined;
    return {
      id: ref.recommenderId,
      displayName: person?.displayName ?? ref.recommenderId,
      note: ref.note?.trim() || undefined,
      type: person?.type ?? 'person',
      url: url || undefined,
    };
  });
}

/** Traveler-added stop that is not on the trusted list. */
export function addedByYou(): RecommendedByPerson[] {
  return [{ id: 'you', displayName: 'you', note: 'Added from your must-do list' }];
}

/** Labeled AI suggestion. Not part of the trusted recommender collection. */
export function recommendedByAi(): RecommendedByPerson[] {
  return [{ id: 'grok', displayName: 'Grok', note: 'AI suggestion, not from the trusted list' }];
}
