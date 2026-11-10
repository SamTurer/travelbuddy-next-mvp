import assert from 'node:assert/strict';
import test from 'node:test';
import { getPlaces, isFoodPlace, visitFitsHours } from '../lib/places';
import { parseMustDo } from '../lib/must-dos';
import { planDay, replanItinerary, type Itinerary, type ItineraryVisit } from '../lib/planner';
import { estimateLeg } from '../lib/routing';
import { weekdayIndex } from '../lib/time';

const places = getPlaces();
const byId = new Map(places.map((place) => [place.id, place]));

function realStops(itinerary: Itinerary): ItineraryVisit[] {
  return itinerary.visits.filter((visit) => visit.role !== 'free');
}

function assertShape(itinerary: Itinerary, label: string) {
  const stops = realStops(itinerary);
  const lunch = stops.filter((visit) => visit.role === 'lunch');
  const dinner = stops.filter((visit) => visit.role === 'dinner');
  assert.equal(lunch.length, 1, `${label} lunch count\n${dump(itinerary)}`);
  assert.equal(dinner.length, 1, `${label} dinner count\n${dump(itinerary)}`);
  for (let index = 1; index < stops.length; index += 1) {
    assert.ok(
      stops[index].startMin >= stops[index - 1].endMin,
      `${label} overlap ${stops[index - 1].title} -> ${stops[index].title}`
    );
  }
  const weekday = weekdayIndex(itinerary.date);
  for (const visit of stops) {
    const place = visit.placeId ? byId.get(visit.placeId) : undefined;
    if (place?.hours) {
      assert.ok(
        visitFitsHours(place, weekday, visit.startMin, visit.endMin - visit.startMin),
        `${label} ${visit.title} outside hours`
      );
    }
    if (visit.role === 'activity' && place) {
      assert.equal(isFoodPlace(place), false, `${label} food in activity slot: ${visit.title}`);
    }
    if (visit.leg) {
      const url = new URL(visit.leg.mapsUrl);
      assert.equal(url.hostname, 'www.google.com');
      assert.equal(url.pathname, '/maps/dir/');
      assert.equal(url.searchParams.get('api'), '1');
      assert.ok(url.searchParams.get('origin'));
      assert.ok(url.searchParams.get('destination'));
      assert.equal(url.searchParams.get('travelmode'), visit.leg.mode === 'walk' ? 'walking' : 'transit');
    }
    if (visit.source === 'curated') {
      const names = (visit.recommendedBy || []).map((person) => person.displayName).sort();
      assert.deepEqual(names, ['Kailey', 'Sam']);
    }
  }
  if (lunch[0] && !lunch[0].pinned) {
    assert.ok(lunch[0].startMin >= 12 * 60 && lunch[0].startMin <= 14 * 60, `${label} lunch ${lunch[0].startMin}`);
  }
  if (dinner[0] && !dinner[0].pinned && dinner[0].startMin >= 18 * 60 + 30) {
    assert.ok(dinner[0].startMin <= 20 * 60 + 30, `${label} dinner ${dinner[0].startMin}`);
  }
  const end = Math.max(...itinerary.visits.map((visit) => visit.endMin));
  assert.ok(end <= 23 * 60 + 15, `${label} ends too late ${end}`);
}

function dump(itinerary: Itinerary): string {
  return itinerary.visits
    .map((visit) => `${visit.startMin}-${visit.endMin} ${visit.role} ${visit.title}`)
    .join('\n');
}

test('chill is about four longer stops with one lunch and one dinner', async () => {
  const chill = await planDay({ date: '2026-11-11', pace: 'chill', vibes: ['classic'], focusArea: null });
  const max = await planDay({ date: '2026-11-11', pace: 'max', vibes: ['classic'], focusArea: null });
  const chillStops = realStops(chill);
  assert.ok(chillStops.length >= 4 && chillStops.length <= 5, dump(chill));
  assert.equal(chillStops.some((visit) => visit.role === 'drinks'), false);
  assertShape(chill, 'chill');
  const avg = (itinerary: Itinerary) => {
    const stops = realStops(itinerary).filter((visit) => visit.role !== 'show');
    return stops.reduce((sum, visit) => sum + (visit.endMin - visit.startMin), 0) / stops.length;
  };
  assert.ok(avg(chill) > avg(max), `chill ${avg(chill)} max ${avg(max)}`);
  assert.ok(chill.visits.some((visit) => visit.role === 'free'), 'spare afternoon is shown as free time');
});

test('8:00 Carbone dinner is 8 PM, including a bare clock with no am/pm', async () => {
  for (const locks of [['Dinner at Carbone 8:00'], [{ title: 'Carbone', time: '8:00' }]]) {
    const itinerary = await planDay({
      date: '2026-11-12',
      pace: 'balanced',
      vibes: ['classic'],
      locks,
    });
    const dinner = realStops(itinerary).find((visit) => /carbone/i.test(visit.title));
    assert.ok(dinner, dump(itinerary));
    assert.equal(dinner.role, 'dinner');
    assert.equal(dinner.startMin, 20 * 60);
    assert.equal(dinner.pinned, true);
    assert.equal(realStops(itinerary).filter((visit) => visit.role === 'dinner').length, 1);
    assert.ok(dinner.startMin > 12 * 60);
    assert.equal(itinerary.bookAhead.some((item) => /carbone/i.test(item.title)), true);
    assert.equal(dinner.recommendedBy[0]?.id, 'you');
    assertShape(itinerary, 'carbone');
  }
});

test('MoMA in the afternoon keeps a real museum duration after lunch', async () => {
  const itinerary = await planDay({
    date: '2026-11-11',
    pace: 'balanced',
    vibes: ['curator'],
    locks: ['MoMA in the afternoon'],
  });
  const visits = itinerary.visits.filter((visit) => visit.title === 'MoMA');
  assert.equal(visits.length, 1);
  const moma = visits[0];
  const lunch = realStops(itinerary).find((visit) => visit.role === 'lunch');
  const dinner = realStops(itinerary).find((visit) => visit.role === 'dinner');
  assert.ok(lunch && dinner);
  assert.ok(moma.startMin >= lunch.endMin);
  assert.ok(moma.endMin <= dinner.startMin);
  const duration = moma.endMin - moma.startMin;
  assert.ok(duration >= 60 && duration <= 120, `duration ${duration}`);
  assert.equal(moma.pinned, false);
  assert.equal(moma.source, 'curated');
  assertShape(itinerary, 'moma');
});

test('Hamilton at 7pm stays at 7pm for about three hours', async () => {
  const itinerary = await planDay({
    date: '2026-11-13',
    pace: 'max',
    vibes: ['curator'],
    locks: ['Hamilton at 7pm'],
  });
  const show = realStops(itinerary).find((visit) => /hamilton/i.test(visit.title));
  assert.ok(show, dump(itinerary));
  assert.equal(show.startMin, 19 * 60);
  assert.equal(show.pinned, true);
  const duration = show.endMin - show.startMin;
  assert.ok(duration >= 150 && duration <= 180, `duration ${duration}`);
  assert.ok(itinerary.warnings.some((warning) => /7:00 PM/.test(warning)));
  assert.ok(show.endMin <= 23 * 60);
  assert.equal(itinerary.bookAhead.some((item) => item.booking === 'tickets_required'), true);
  assertShape(itinerary, 'hamilton');
});

test('a Saturday with no focus stays in one or two neighborhoods', async () => {
  const itinerary = await planDay({
    date: '2026-11-14',
    pace: 'balanced',
    vibes: ['local'],
    focusArea: null,
  });
  const stops = realStops(itinerary);
  assert.ok(stops.length >= 5 && stops.length <= 6, dump(itinerary));
  assert.ok(itinerary.cluster.hoods.length <= 2);
  for (const visit of stops) {
    if (visit.hoodId) assert.ok(itinerary.cluster.hoods.includes(visit.hoodId), visit.title);
  }
  const transit = stops.reduce((sum, visit) => sum + (visit.leg?.minutes ?? 0), 0);
  assert.ok(transit < 80, `transit ${transit}\n${dump(itinerary)}`);
  const drinks = stops.find((visit) => visit.role === 'drinks');
  const dinner = stops.find((visit) => visit.role === 'dinner');
  assert.ok(drinks && dinner);
  assert.ok(drinks.startMin >= dinner.endMin);
  assert.ok(Math.max(...stops.map((visit) => visit.endMin)) > 21 * 60);
  assertShape(itinerary, 'saturday');
  const url = new URL(itinerary.mapsUrl);
  assert.equal(url.searchParams.get('api'), '1');
  assert.ok(url.searchParams.get('origin'));
  assert.ok(url.searchParams.get('destination'));
  assert.ok(url.searchParams.get('waypoints'));
});

test('Tribeca, Harlem, and Central Park focus days stay in that part of town', async () => {
  const tribeca = await planDay({ date: '2026-11-14', pace: 'balanced', vibes: ['local'], focusArea: 'tribeca' });
  assert.ok(tribeca.cluster.hoods.includes('tribeca'));
  assert.ok(tribeca.cluster.hoods.length <= 2);
  assert.ok(realStops(tribeca).some((visit) => visit.hoodId === 'tribeca'));
  assertShape(tribeca, 'tribeca');

  const harlem = await planDay({ date: '2026-11-14', pace: 'balanced', vibes: ['local'], focusArea: 'harlem' });
  const uptown = new Set(['harlem', 'uws', 'central-park']);
  assert.ok(realStops(harlem).some((visit) => visit.hoodId === 'harlem'), dump(harlem));
  for (const hood of harlem.cluster.hoods) assert.ok(uptown.has(hood), hood);
  assertShape(harlem, 'harlem');

  const park = await planDay({ date: '2026-11-15', pace: 'balanced', vibes: ['classic'], focusArea: 'central park' });
  assert.ok(park.cluster.hoods.includes('central-park'));
  assert.ok(realStops(park).some((visit) => visit.hoodId === 'central-park'), dump(park));
  assertShape(park, 'central park');
});

test('opening hours hold across the week, paces, and focus areas', async () => {
  const dates = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
  const focuses = [null, 'tribeca', 'harlem', 'central park', 'west village greenwich village'];
  for (const date of dates) {
    for (const pace of ['chill', 'balanced', 'max'] as const) {
      for (const focusArea of focuses) {
        const itinerary = await planDay({ date, pace, vibes: ['local'], focusArea });
        assertShape(itinerary, `${date} ${pace} ${focusArea ?? 'any'}`);
        const count = realStops(itinerary).length;
        if (pace === 'chill') assert.ok(count >= 3 && count <= 5);
        if (pace === 'balanced') assert.ok(count >= 4 && count <= 7);
        if (pace === 'max') assert.ok(count >= 6 && count <= 9);
      }
    }
  }
});

test('an unmatched must-do is kept as plain text, and a closed pin is not moved', async () => {
  const plain = await planDay({
    date: '2026-11-14',
    pace: 'balanced',
    vibes: ['local'],
    locks: ['Secret rooftop from my friend'],
  });
  assert.ok(realStops(plain).some((visit) => /secret rooftop/i.test(visit.title)));

  const closed = await planDay({
    date: '2026-11-11',
    pace: 'balanced',
    vibes: ['curator'],
    locks: ['MoMA at 8:00 PM'],
  });
  const moma = realStops(closed).find((visit) => visit.title === 'MoMA');
  assert.ok(moma);
  assert.equal(moma.startMin, 20 * 60);
  assert.ok(closed.warnings.some((warning) => /MoMA/.test(warning) && /kept/i.test(warning)));
});

test('walk under about 20 minutes, transit otherwise, and scenic walks stay on foot', () => {
  const village = estimateLeg({ lat: 40.733, lng: -74.004, label: 'Via Carota' }, { lat: 40.7355, lng: -74.002, label: 'Waverly Inn' });
  assert.equal(village.mode, 'walk');
  assert.match(village.summary, /walk/);
  assert.equal(new URL(village.mapsUrl).searchParams.get('travelmode'), 'walking');

  const far = estimateLeg({ lat: 40.787, lng: -73.975, label: 'Upper West Side' }, { lat: 40.708, lng: -73.957, label: 'Williamsburg' });
  assert.equal(far.mode, 'transit');
  assert.ok(far.lines.length > 0, far.summary);
  assert.match(far.summary, /subway\/bus/);
  assert.equal(new URL(far.mapsUrl).searchParams.get('travelmode'), 'transit');

  const highLine = estimateLeg({ lat: 40.7408, lng: -74.008, label: 'High Line south' }, { lat: 40.7535, lng: -74.0025, label: 'High Line north' });
  assert.equal(highLine.mode, 'walk');
  assert.match(highLine.summary, /High Line/);
  assert.ok(highLine.minutes > 20);
});

test('the deterministic parser reads bare dinner times as PM and matches MoMA', () => {
  const carbone = parseMustDo({ title: 'Carbone', time: '8:00' }, places);
  assert.ok(carbone);
  assert.equal(carbone.pinnedStart, 20 * 60);
  assert.equal(carbone.slot, 'dinner');

  const moma = parseMustDo('MoMA in the afternoon', places);
  assert.ok(moma);
  assert.equal(moma.title, 'MoMA');
  assert.equal(moma.daypart, 'afternoon');
  assert.equal(moma.pinnedStart, null);
  assert.equal(moma.place?.name, 'MoMA');

  const show = parseMustDo('Hamilton at 7pm', places);
  assert.ok(show);
  assert.equal(show.pinnedStart, 19 * 60);
  assert.ok(show.duration >= 150);
});

test('a shared location becomes the first leg and does not move the day earlier', async () => {
  const itinerary = await planDay({
    date: '2026-11-11',
    pace: 'chill',
    vibes: ['classic'],
    startLocation: { lat: 40.7128, lng: -74.006, label: 'Your location' },
  });
  const first = realStops(itinerary)[0];
  assert.ok(first.leg, dump(itinerary));
  assert.match(first.leg.summary, /From your location/);
  assert.equal(new URL(first.leg.mapsUrl).searchParams.get('travelmode'), first.leg.mode === 'walk' ? 'walking' : 'transit');
  assert.ok(first.startMin >= 8 * 60 + 30);
  const lunch = realStops(itinerary).find((visit) => visit.role === 'lunch');
  assert.ok(lunch && lunch.startMin >= 12 * 60);
  assert.ok(itinerary.mapsUrl.includes('origin='));
});

test('replanning a stop still respects opening hours', async () => {
  const itinerary = await planDay({ date: '2026-11-14', pace: 'balanced', vibes: ['local'], focusArea: 'tribeca' });
  const visible = itinerary.stops.filter((stop) => stop.kind !== 'transit');
  const index = visible.findIndex((stop) => stop.role === 'activity');
  assert.ok(index >= 0);
  const replanned = await replanItinerary({
    date: '2026-11-14',
    pace: 'balanced',
    vibes: ['local'],
    focusArea: 'tribeca',
    mood: 'Weather Changed',
    replaceIndex: index,
    stops: visible,
  });
  assertShape(replanned, 'replan');
});
