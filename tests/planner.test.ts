import assert from 'node:assert/strict';
import test from 'node:test';
import { branchesOf, getPlaces, getPlanningPlaces, isFoodPlace, visitFitsHours, type Place } from '../lib/places';
import { describeMatch, parseMustDo } from '../lib/must-dos';
import { enrichLocksWithAI } from '../lib/ai';
import UnderstoodMatch from '../app/components/UnderstoodMatch';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { planDay, replanItinerary, type Itinerary, type ItineraryVisit } from '../lib/planner';
import { AREA_OPTIONS, coerceManhattanFocus } from '../lib/areas';
import { focusHoodId, hoodForPlace } from '../lib/neighborhoods';
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
    const hours = visit.hours ?? place?.hours;
    if (hours) {
      assert.ok(
        visitFitsHours({ hours }, weekday, visit.startMin, visit.endMin - visit.startMin),
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
      const people = visit.recommendedBy || [];
      assert.ok(people.length > 0, `${label} ${visit.title} has no recommender`);
      for (const person of people) {
        assert.ok(person.displayName && person.displayName !== person.id, `${label} ${visit.title} ${person.id}`);
      }
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

test('Met Museum at noon matches The Met and keeps the clock time', async () => {
  const parsed = parseMustDo('Met Museum at noon', places);
  assert.ok(parsed);
  assert.equal(parsed.place?.id, 'the-met');
  assert.equal(parsed.title, 'The Met');
  assert.equal(parsed.neighborhood, 'Upper East Side');
  assert.equal(parsed.pinnedStart, 12 * 60);
  assert.equal(describeMatch(parsed), 'The Met in Upper East Side at 12:00 PM');

  for (const phrase of ['the met at 12', 'Met Museum at 12pm', 'Metropolitan Museum at noon']) {
    const item = parseMustDo(phrase, places);
    assert.equal(item?.place?.id, 'the-met', phrase);
    assert.equal(item?.pinnedStart, 12 * 60, phrase);
  }
  assert.equal(parseMustDo('Met Museum at 3:30', places)?.pinnedStart, 15 * 60 + 30);
  assert.equal(parseMustDo('Comedy Cellar at midnight', places)?.pinnedStart, 0);
  assert.equal(parseMustDo('Guggenheim', places)?.place?.id, 'guggenheim');
  assert.equal(parseMustDo("Katz's", places)?.place?.id, 'katz-s-deli');
  assert.equal(parseMustDo('high line', places)?.place?.id, 'the-high-line');
  assert.equal(parseMustDo('Whitney Museum', places)?.place?.neighborhood, 'Meatpacking / West Village edge');
  assert.equal(parseMustDo('zzzz not a place', places)?.place, null);
  assert.equal(parseMustDo('noon at the met', places)?.pinnedStart, 12 * 60);
  assert.equal(parseMustDo('the met around 12', places)?.pinnedStart, 12 * 60);
  assert.equal(parseMustDo('met musuem', places)?.place?.id, 'the-met');
  assert.equal(parseMustDo('noontime at the met', places)?.pinnedStart, 12 * 60);

  const zabars = parseMustDo('zabars at lunchtime', places);
  assert.ok(zabars);
  assert.equal(zabars.place?.id, 'zabars');
  assert.equal(zabars.neighborhood, 'Upper West Side');
  assert.equal(zabars.slot, 'lunch');
  assert.equal(zabars.pinnedStart, null);
  assert.equal(describeMatch(zabars), 'Zabars in Upper West Side for lunch');

  for (const phrase of ["Zabar's at lunch", 'lunch at zabars', 'around lunchtime at zabars']) {
    const item = parseMustDo(phrase, places);
    assert.equal(item?.place?.id, 'zabars', phrase);
    assert.equal(item?.slot, 'lunch', phrase);
    assert.equal(item?.pinnedStart, null, phrase);
  }
  assert.equal(parseMustDo('zaabars', places)?.place?.id, 'zabars');
  assert.equal(parseMustDo('zabars', places)?.slot, 'activity');

  const levain = parseMustDo('levain for breakfast', places);
  assert.equal(levain?.place?.id, 'levain-bakery');
  assert.equal(levain?.slot, 'breakfast');
  assert.equal(parseMustDo('in the morning at levain', places)?.slot, 'breakfast');
  assert.equal(parseMustDo('dinnertime at via carota', places)?.slot, 'dinner');
  assert.equal(parseMustDo('Carbone for dinner', places)?.slot, 'dinner');
  assert.equal(parseMustDo('hamilton at 8', places)?.pinnedStart, 20 * 60);
  assert.equal(parseMustDo('Comedy Cellar tonight', places)?.place, null);
  assert.equal(parseMustDo('Comedy Cellar tonight', places)?.neighborhood, 'Greenwich Village');

  const unknown = parseMustDo('zzzz not a real place', places);
  assert.equal(unknown?.plainText, true);
  assert.equal(unknown?.title, 'zzzz not a real place');

  const preview = await enrichLocksWithAI([{ title: 'zabars at lunchtime' }], {
    city: 'New York City',
    date: '2026-11-14',
  });
  assert.equal(preview[0]?.matched, true);
  assert.equal(preview[0]?.title, 'Zabars');
  assert.equal(preview[0]?.location, 'Upper West Side');
  assert.equal(preview[0]?.detail, 'for lunch');
  assert.equal(preview[0]?.time, undefined);

  const day = await planDay({
    date: '2026-11-14',
    pace: 'balanced',
    vibes: ['classic'],
    locks: ['zabars at lunchtime'],
  });
  const zabarsLunch = realStops(day).find((visit) => visit.role === 'lunch');
  assert.ok(zabarsLunch, dump(day));
  assert.equal(zabarsLunch.placeId, 'zabars');
  assert.ok(zabarsLunch.startMin >= 12 * 60 && zabarsLunch.startMin <= 14 * 60, dump(day));

  const maman = await planDay({
    date: '2026-11-14',
    pace: 'balanced',
    vibes: ['classic'],
    locks: ['coffee at maman'],
  });
  assert.ok(realStops(maman).some((visit) => visit.placeId === 'maman'), dump(maman));

  const html = renderToStaticMarkup(
    createElement(UnderstoodMatch, { title: 'The Met', neighborhood: 'Upper East Side', time: '12:00 PM' })
  );
  assert.match(html, /Understood as/);
  assert.match(html, />The Met</);
  assert.match(html, /Upper East Side/);
  assert.match(html, /12:00 PM/);

  const saturday = await planDay({
    date: '2026-11-14',
    pace: 'balanced',
    vibes: ['classic'],
    focusArea: null,
    locks: ['Met Museum at noon'],
  });
  const met = realStops(saturday).find((visit) => visit.placeId === 'the-met');
  assert.ok(met, dump(saturday));
  assert.equal(met.startMin, 12 * 60);
  assert.equal(met.understood?.title, 'The Met');
  assert.equal(met.understood?.neighborhood, 'Upper East Side');
  assert.equal(met.pinned, true);
  assert.ok(saturday.cluster.hoods.includes('ues'), saturday.cluster.label);
  const lunch = realStops(saturday).find((visit) => visit.role === 'lunch');
  assert.ok(lunch && lunch.startMin >= met.endMin, dump(saturday));
  const coffee = realStops(saturday).find((visit) => visit.role === 'coffee');
  assert.ok(coffee, dump(saturday));
  assert.ok(coffee.startMin < met.startMin);
  assert.ok(met.leg, 'the leg into the Met is routed from the previous stop');
  assert.ok((coffee.lat ?? 0) > 40.75, `coffee should be uptown, near the Met\n${dump(saturday)}`);

  const closed = await planDay({
    date: '2026-11-11',
    pace: 'balanced',
    vibes: ['classic'],
    locks: ['Met Museum at noon'],
  });
  const closedMet = realStops(closed).find((visit) => visit.placeId === 'the-met');
  assert.ok(closedMet, dump(closed));
  assert.equal(closedMet.startMin, 12 * 60);
  assert.ok(closed.warnings.some((warning) => /The Met is closed at 12:00 PM/.test(warning)), closed.warnings.join(' | '));
});

test('brunch is its own meal and is not planned as breakfast', async () => {
  const parsed = parseMustDo('brunch at Buvette', places);
  assert.ok(parsed);
  assert.equal(parsed.place?.id, 'buvette');
  assert.equal(parsed.neighborhood, 'West Village');
  assert.equal(parsed.slot, 'brunch');
  assert.equal(parsed.pinnedStart, null);
  assert.equal(describeMatch(parsed), 'Buvette in West Village for brunch');

  for (const phrase of ['Buvette for brunch', 'brunchtime at Buvette', 'Sunday brunch at Buvette']) {
    const item = parseMustDo(phrase, places);
    assert.equal(item?.place?.id, 'buvette', phrase);
    assert.equal(item?.slot, 'brunch', phrase);
    assert.equal(item?.pinnedStart, null, phrase);
  }

  const pinned = parseMustDo('brunch at Buvette at 11', places);
  assert.equal(pinned?.place?.id, 'buvette');
  assert.equal(pinned?.slot, 'brunch');
  assert.equal(pinned?.pinnedStart, 11 * 60);
  assert.equal(describeMatch(pinned!), 'Buvette in West Village at 11:00 AM');

  const preview = await enrichLocksWithAI([{ title: 'brunch at Buvette' }], {
    city: 'New York City',
    date: '2026-11-15',
  });
  assert.equal(preview[0]?.matched, true);
  assert.equal(preview[0]?.title, 'Buvette');
  assert.equal(preview[0]?.location, 'West Village');
  assert.equal(preview[0]?.detail, 'for brunch');
  assert.equal(preview[0]?.time, undefined);

  const day = await planDay({
    date: '2026-11-15',
    pace: 'balanced',
    vibes: ['classic'],
    locks: ['brunch at Buvette'],
  });
  const stop = realStops(day).find((visit) => visit.placeId === 'buvette');
  assert.ok(stop, dump(day));
  assert.equal(stop.role, 'brunch');
  assert.ok(stop.startMin >= 10 * 60 && stop.startMin <= 13 * 60, dump(day));
  assert.ok(stop.startMin !== 9 * 60 + 30, dump(day));
  const lunch = realStops(day).find((visit) => visit.role === 'lunch');
  assert.ok(lunch && lunch.startMin >= stop.endMin, dump(day));
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

test('closed and temporarily closed places are not scheduled', async () => {
  assert.equal(getPlanningPlaces().some((place) => /bar primi|gallow green/i.test(place.name)), false);
  const itinerary = await planDay({ date: '2026-11-14', pace: 'max', vibes: ['classic'], focusArea: 'flatiron chelsea' });
  assert.equal(realStops(itinerary).some((visit) => /bar primi|gallow green/i.test(visit.title)), false);
  const forced = await planDay({
    date: '2026-11-14',
    pace: 'balanced',
    vibes: ['local'],
    locks: ['Bar Primi'],
  });
  assert.equal(realStops(forced).some((visit) => /bar primi/i.test(visit.title)), false);
  assert.ok(forced.warnings.some((warning) => /temporarily closed/i.test(warning)));
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

const DAY_HOURS: Place['hours'] = Array.from({ length: 7 }, () => [[8 * 60, 22 * 60]]);

function westVillageSpot(fields: {
  id: string;
  name: string;
  category: string;
  categories?: string[];
  lat: number;
  lng: number;
  placeholder?: boolean;
  vibe_tags?: string[];
  energy_tags?: string[];
  locations?: Place['locations'];
  address?: string;
}): Place {
  const categories = fields.categories ?? [fields.category];
  return {
    id: fields.id,
    name: fields.name,
    category: fields.category,
    categories,
    neighborhood: 'West Village',
    area: 'Downtown',
    lat: fields.lat,
    lng: fields.lng,
    duration_min: 30,
    duration_max: 60,
    vibe_tags: fields.vibe_tags ?? [],
    energy_tags: fields.energy_tags ?? [],
    description: '',
    hours: DAY_HOURS,
    recommended_by: [{ recommenderId: fields.placeholder ? 'the-infatuation' : 'sam' }],
    note: '',
    booking: 'walk_in',
    placeholder: fields.placeholder,
    address: fields.address,
    locations: fields.locations ?? [
      {
        id: `${fields.id}-main`,
        label: 'West Village',
        address: fields.address ?? '1 Grove St',
        lat: fields.lat,
        lng: fields.lng,
        neighborhood: 'West Village',
        hours: DAY_HOURS,
      },
    ],
    status: 'open',
  };
}

test('coffee slots use the nearest branch and prefer a real recommendation when it is as close', async () => {
  const anchor = { lat: 40.735, lng: -74.003 };
  const day = [
    westVillageSpot({ id: 'activity-wv', name: 'Village Museum', category: 'museum', lat: anchor.lat, lng: anchor.lng }),
    westVillageSpot({ id: 'lunch-wv', name: 'Village Lunch', category: 'lunch', lat: anchor.lat, lng: anchor.lng }),
    westVillageSpot({ id: 'dinner-wv', name: 'Village Dinner', category: 'dinner', lat: anchor.lat, lng: anchor.lng }),
  ];
  const trusted = westVillageSpot({
    id: 'trusted-coffee',
    name: 'Trusted Coffee',
    category: 'coffee',
    lat: anchor.lat,
    lng: anchor.lng,
    address: '10 Grove St',
  });
  const placeholder = westVillageSpot({
    id: 'placeholder-coffee',
    name: 'A Placeholder Coffee',
    category: 'coffee',
    lat: anchor.lat,
    lng: anchor.lng,
    placeholder: true,
    vibe_tags: ['local', 'cafe'],
    energy_tags: ['local'],
    address: '12 Grove St',
  });
  const tied = await planDay(
    { date: '2026-11-11', pace: 'chill', vibes: ['local'], focusArea: 'west village greenwich village' },
    [...day, trusted, placeholder]
  );
  const tiedStop = realStops(tied).find((visit) => visit.role === 'coffee');
  assert.ok(tiedStop, dump(tied));
  assert.equal(tiedStop.title, 'Trusted Coffee');
  assert.equal(tiedStop.address, '10 Grove St');
  assert.equal(tiedStop.recommendedBy?.[0]?.displayName, 'Sam');

  const nearerPlaceholder = westVillageSpot({
    ...placeholder,
    lat: anchor.lat,
    lng: anchor.lng,
    locations: [
      {
        id: 'placeholder-near',
        label: 'West Village',
        address: '12 Grove St',
        lat: anchor.lat,
        lng: anchor.lng,
        neighborhood: 'West Village',
        hours: DAY_HOURS,
      },
    ],
  });
  const fartherTrusted = westVillageSpot({
    ...trusted,
    lat: anchor.lat + 0.012,
    lng: anchor.lng,
    locations: [
      {
        id: 'trusted-far',
        label: 'West Village',
        address: '400 Hudson St',
        lat: anchor.lat + 0.012,
        lng: anchor.lng,
        neighborhood: 'West Village',
        hours: DAY_HOURS,
      },
    ],
  });
  const closer = await planDay(
    { date: '2026-11-11', pace: 'chill', vibes: ['local'], focusArea: 'west village greenwich village' },
    [...day, fartherTrusted, nearerPlaceholder]
  );
  const closerStop = realStops(closer).find((visit) => visit.role === 'coffee');
  assert.ok(closerStop, dump(closer));
  assert.equal(closerStop.title, 'A Placeholder Coffee');
  assert.equal(closerStop.address, '12 Grove St');
  assert.equal(closerStop.recommendedBy?.[0]?.displayName, 'The Infatuation');

  const chain = westVillageSpot({
    id: 'chain-coffee',
    name: 'Chain Coffee',
    category: 'coffee',
    lat: anchor.lat,
    lng: anchor.lng,
    address: '1 Grove St',
    locations: [
      {
        id: 'chain-village',
        label: 'West Village',
        address: '1 Grove St',
        lat: anchor.lat,
        lng: anchor.lng,
        neighborhood: 'West Village',
        hours: DAY_HOURS,
      },
      {
        id: 'chain-midtown',
        label: 'Midtown',
        address: '1 W 42nd St',
        lat: 40.755,
        lng: -73.986,
        neighborhood: 'Midtown',
        hours: DAY_HOURS,
      },
    ],
  });
  const branched = await planDay(
    { date: '2026-11-11', pace: 'chill', vibes: ['classic'], focusArea: 'west village greenwich village' },
    [...day, chain]
  );
  const branchedStop = realStops(branched).find((visit) => visit.role === 'coffee');
  assert.ok(branchedStop, dump(branched));
  assert.equal(branchedStop.title, 'Chain Coffee');
  assert.equal(branchedStop.address, '1 Grove St');
  assert.ok(Math.abs((branchedStop.lat ?? 0) - anchor.lat) < 1e-6);
});

test('real coffee shops fill the morning slot from the nearest open branch', async () => {
  const focuses: { focusArea: string; anchor: { lat: number; lng: number } }[] = [
    { focusArea: 'upper west side', anchor: { lat: 40.787, lng: -73.9754 } },
    { focusArea: 'west village greenwich village', anchor: { lat: 40.735, lng: -74.003 } },
    { focusArea: 'harlem', anchor: { lat: 40.8116, lng: -73.9465 } },
    { focusArea: 'tribeca', anchor: { lat: 40.7163, lng: -74.0086 } },
  ];
  for (const { focusArea, anchor } of focuses) {
    const itinerary = await planDay({ date: '2026-11-14', pace: 'balanced', vibes: ['local'], focusArea });
    const coffee = realStops(itinerary).find((visit) => visit.role === 'coffee');
    assert.ok(coffee, `${focusArea}\n${dump(itinerary)}`);
    const place = byId.get(coffee.placeId || '');
    assert.ok(place, coffee.title);
    assert.ok(place.categories.includes('coffee'), place.name);
    const branch = branchesOf(place).find(
      (item) => Math.abs(item.lat - (coffee.lat ?? 0)) < 1e-6 && Math.abs(item.lng - (coffee.lng ?? 0)) < 1e-6
    );
    assert.ok(branch, `${place.name} is not on one of its branches`);
    assert.equal(coffee.address || '', branch.address || '');
    const weekday = weekdayIndex(itinerary.date);
    const branchHood = (item: (typeof branch)) =>
      hoodForPlace({ ...place, lat: item.lat, lng: item.lng, neighborhood: place.neighborhood }) ||
      hoodForPlace({ ...place, lat: item.lat, lng: item.lng, neighborhood: item.label || '' }) ||
      hoodForPlace({ ...place, lat: item.lat, lng: item.lng, neighborhood: item.neighborhood || '' });
    const chosenMinutes = estimateLeg(anchor, branch).minutes;
    const closer = branchesOf(place).filter((item) => {
      if (item.lat === branch.lat && item.lng === branch.lng) return false;
      const hood = branchHood(item);
      if (!hood || !itinerary.cluster.hoods.includes(hood)) return false;
      if (!visitFitsHours({ hours: item.hours }, weekday, coffee.startMin, 30)) return false;
      return estimateLeg(anchor, item).minutes + 1 < chosenMinutes;
    });
    assert.deepEqual(
      closer.map((item) => item.address),
      [],
      `${focusArea} ${place.name} skipped a closer branch`
    );
  }
});

test('the area picker is Manhattan only and an old outer-borough choice is no focus', async () => {
  const labels = AREA_OPTIONS.map((option) => option.label);
  assert.equal(labels.includes('Brooklyn'), false);
  assert.equal(
    labels.some((label) => /queens|bronx|staten|williamsburg|dumbo|long island/i.test(label)),
    false
  );
  assert.ok(labels.includes('Harlem'));
  assert.ok(labels.includes('Upper West Side'));
  assert.equal(coerceManhattanFocus('brooklyn'), null);
  assert.equal(coerceManhattanFocus('Williamsburg'), null);
  assert.equal(coerceManhattanFocus('Long Island City'), null);
  assert.equal(coerceManhattanFocus('harlem'), 'harlem');
  assert.equal(focusHoodId('brooklyn'), null);
  assert.equal(focusHoodId('williamsburg'), null);
  assert.equal(focusHoodId('queens'), null);
  assert.equal(focusHoodId('harlem'), 'harlem');
  const day = await planDay({ date: '2026-11-14', pace: 'balanced', vibes: ['classic'], focusArea: 'brooklyn' });
  assert.ok(realStops(day).length >= 4, dump(day));
  assert.equal(day.cluster.hoods.includes('williamsburg'), false);
});
