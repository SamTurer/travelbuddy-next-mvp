import rawRecommenders from '../data/recommenders.json';

export type Recommender = {
  id: string;
  displayName: string;
  /** Short bio / why this person is trustworthy for these kinds of places. */
  bio: string;
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
};

export const recommenders = rawRecommenders as Recommender[];

const byId = new Map(recommenders.map((person) => [person.id, person]));

export function getRecommenders(): Recommender[] {
  return recommenders;
}

export function getRecommender(id: string): Recommender | undefined {
  return byId.get(id);
}

export function formatRecommendedBy(people: { displayName: string }[]): string {
  const names = people.map((person) => person.displayName).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function resolveRecommendations(refs: RecommendationRef[] | undefined): RecommendedByPerson[] {
  return (refs ?? []).map((ref) => {
    const person = getRecommender(ref.recommenderId);
    return {
      id: ref.recommenderId,
      displayName: person?.displayName ?? ref.recommenderId,
      note: ref.note?.trim() || undefined,
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
