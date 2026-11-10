import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecommendedBy from '../app/components/RecommendedBy';
import { getPlaces } from '../lib/places';
import { getRecommenders } from '../lib/recommenders';
import { validatePlaces, validateCuratedList } from '../lib/validate-places';
import type { Place } from '../lib/places';

test('every curated place is recommended by Sam and Kailey and has a booking field', () => {
  const places = getPlaces();
  assert.ok(places.length > 280);
  for (const place of places) {
    assert.deepEqual(
      place.recommended_by.map((ref) => ref.recommenderId).sort(),
      ['kailey', 'sam']
    );
    assert.equal(typeof place.note, 'string');
    assert.equal(place.booking, 'unknown');
    assert.equal(typeof place.lat, 'number');
    assert.equal(typeof place.lng, 'number');
  }
});

test('near-duplicate venues were merged', () => {
  const names = getPlaces().map((place) => place.name);
  for (const name of ['Via Carota', 'Buvette', 'Banter', 'Two Hands', 'Santo Taco', "Bloomingdale's"]) {
    assert.equal(names.filter((item) => item === name).length, 1, name);
  }
  assert.equal(names.some((name) => /Via Carota \(/.test(name)), false);
  assert.equal(names.some((name) => /Buvette \(/.test(name)), false);
});

test('recommenders are seeded for a future profile page', () => {
  const people = getRecommenders();
  const sam = people.find((person) => person.id === 'sam');
  const kailey = people.find((person) => person.id === 'kailey');
  assert.ok(sam);
  assert.ok(kailey);
  assert.equal(sam.displayName, 'Sam');
  assert.equal(kailey.displayName, 'Kailey');
  assert.ok(sam.bio.length > 10);
  assert.ok(kailey.bio.length > 10);
  assert.ok(Array.isArray(sam.specialties));
});

test('the curated file has coordinates and no near-duplicates, and missing hours are reported', () => {
  const report = validateCuratedList(getPlaces());
  assert.deepEqual(report.errors, []);
  assert.equal(report.duplicateGroups.length, 0);
  assert.ok(report.missingHours.length > 0);
});

test('the validator catches a missing coordinate, a duplicate, and missing hours', () => {
  const base = {
    id: 'a',
    name: 'Alpha',
    category: 'dinner',
    categories: ['dinner'],
    neighborhood: 'West Village',
    area: 'Downtown',
    lat: 40.73,
    lng: -74.0,
    duration_min: 60,
    duration_max: 90,
    vibe_tags: [],
    energy_tags: [],
    description: '',
    hours: [[[0, 60]]] as Place['hours'],
    outdoor: false,
    recommended_by: [{ recommenderId: 'sam' }],
    note: '',
    booking: 'unknown' as const,
  };
  const report = validatePlaces(
    [
      base,
      { ...base, id: 'b', name: 'Alpha (West Village)', lat: 40.7301 },
      { ...base, id: 'c', name: 'No Hours', hours: null, lat: 40.75 },
      { ...base, id: 'd', name: 'No Pin', lat: Number.NaN, lng: Number.NaN },
    ],
    ['sam', 'kailey']
  );
  assert.ok(report.errors.some((error) => /coordinate/i.test(error)));
  assert.ok(report.duplicateGroups.length >= 1);
  assert.ok(report.missingHours.includes('No Hours'));
});

test('Recommended by renders each name for a future profile link and is not a link yet', () => {
  const html = renderToStaticMarkup(
    createElement(RecommendedBy, {
      people: [
        { id: 'sam', displayName: 'Sam' },
        { id: 'kailey', displayName: 'Kailey', note: 'Order the spritz' },
      ],
    })
  );
  assert.match(html, /Recommended by/);
  assert.match(html, /data-recommender-id="sam"/);
  assert.match(html, /data-recommender-id="kailey"/);
  assert.match(html, />Sam</);
  assert.match(html, />Kailey</);
  assert.doesNotMatch(html, /<a /);
});
