import React from 'react';

/** Shows the place, neighborhood, and time a free-text must-do resolved to. */
export default function UnderstoodMatch({
  title,
  neighborhood,
  time,
}: {
  title: string;
  neighborhood?: string;
  time?: string;
}) {
  return (
    <p data-understood="true" className="text-sm text-slate-700">
      Understood as <strong>{title}</strong>
      {neighborhood ? <> in {neighborhood}</> : null}
      {time ? <> at {time}</> : null}
    </p>
  );
}
