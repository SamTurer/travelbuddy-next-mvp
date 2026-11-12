import React from 'react';

/** Shows the place, neighborhood, and time a free-text must-do resolved to. */
export default function UnderstoodMatch({
  title,
  neighborhood,
  time,
  detail,
}: {
  title: string;
  neighborhood?: string;
  time?: string;
  detail?: string;
}) {
  return (
    <p data-understood="true" className="text-sm text-ink">
      Understood as <strong>{title}</strong>
      {neighborhood ? <> in {neighborhood}</> : null}
      {time ? <> at {time}</> : null}
      {!time && detail ? <> {detail}</> : null}
    </p>
  );
}
