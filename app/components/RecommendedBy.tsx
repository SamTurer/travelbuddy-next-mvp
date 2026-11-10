import React from 'react';
import { formatRecommendedBy, isPublication, type RecommendedByPerson } from '@/lib/recommenders';

/**
 * Visible "Recommended by …" line.
 * Each name is its own element with data-recommender-id so a later profile
 * page can wrap it in <Link href={`/recommenders/${person.id}`}> without
 * changing the data. Publication titles are shown as citations, not slugs.
 */
export default function RecommendedBy({ people }: { people?: RecommendedByPerson[] }) {
  if (!people?.length) return null;
  const label = formatRecommendedBy(people);
  const cite = people.some((person) => isPublication(person));
  return (
    <p className="mt-1 text-sm text-slate-600">
      <span className="text-slate-500">Recommended by </span>
      {people.map((person, index) => (
        <span key={`${person.id}-${index}`}>
          {index > 0 ? (cite ? ', ' : index === people.length - 1 ? ' & ' : ', ') : null}
          <span
            data-recommender-id={person.id}
            data-recommender-type={person.type || 'person'}
            data-recommender-url={person.url || undefined}
            title={person.note || undefined}
            className="font-medium text-slate-800"
          >
            {person.displayName}
          </span>
        </span>
      ))}
      <span className="sr-only">{label}</span>
    </p>
  );
}
