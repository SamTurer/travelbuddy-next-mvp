import { haversineKm } from './neighborhoods';
import { BOOKING_KINDS, isBookingKind, type Place } from './places';
import { getRecommenders } from './recommenders';

export type ValidationReport = {
  errors: string[];
  missingHours: string[];
  duplicateGroups: string[][];
  suspectCoordinates: string[];
};

function baseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validatePlaces(places: Place[], recommenderIds: string[]): ValidationReport {
  const errors: string[] = [];
  const missingHours: string[] = [];
  const duplicateGroups: string[][] = [];
  const suspectCoordinates: string[] = [];
  const ids = new Set<string>();
  const known = new Set(recommenderIds);

  places.forEach((place, index) => {
    const label = place.name || `record ${index}`;
    if (!place.id) errors.push(`${label} is missing an id`);
    else if (ids.has(place.id)) errors.push(`Duplicate id ${place.id}`);
    else ids.add(place.id);
    if (!place.name?.trim()) errors.push(`Record ${index} is missing a name`);
    if (!Array.isArray(place.categories) || place.categories.length === 0) {
      errors.push(`${label} is missing categories`);
    }
    if (typeof place.lat !== 'number' || typeof place.lng !== 'number' || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
      errors.push(`${label} is missing coordinates`);
    } else if (place.lat < 40.45 || place.lat > 40.95 || place.lng < -74.35 || place.lng > -73.68) {
      errors.push(`${label} coordinates are outside NYC (${place.lat}, ${place.lng})`);
    }
    if (!place.hours && !(place.locations ?? []).some((branch) => branch.hours)) missingHours.push(place.name);
    if (place.status && !['open', 'closed', 'temporarily_closed', 'unverified'].includes(place.status)) {
      errors.push(`${label} has unknown status "${place.status}"`);
    }
    for (const branch of place.locations ?? []) {
      const branchLabel = `${place.name} / ${branch.label || branch.id}`;
      if (!Number.isFinite(branch.lat) || !Number.isFinite(branch.lng)) {
        errors.push(`${branchLabel} is missing coordinates`);
      }
      if (!branch.hours) missingHours.push(branchLabel);
    }
    if (typeof place.note !== 'string') errors.push(`${label} is missing a note field`);
    if (!place.booking || !isBookingKind(place.booking)) {
      errors.push(`${label} has invalid booking "${place.booking ?? ''}"`);
    }
    if (!Array.isArray(place.recommended_by) || place.recommended_by.length === 0) {
      errors.push(`${label} needs at least one recommender`);
    } else {
      for (const ref of [...place.recommended_by, ...(place.source_refs ?? [])]) {
        if (!ref?.recommenderId || !known.has(ref.recommenderId)) {
          errors.push(`${label} references unknown recommender "${ref?.recommenderId ?? ''}"`);
        }
      }
    }
  });

  const byBase = new Map<string, Place[]>();
  for (const place of places) {
    if (typeof place.lat !== 'number' || typeof place.lng !== 'number') continue;
    const key = baseName(place.name);
    const list = byBase.get(key) ?? [];
    list.push(place);
    byBase.set(key, list);
  }
  for (const [key, group] of byBase) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const distance = haversineKm(group[i], group[j]);
        if (distance <= 0.15) {
          duplicateGroups.push([group[i].name, group[j].name, key]);
          errors.push(`Near-duplicate places: ${group[i].name} and ${group[j].name}`);
        }
      }
    }
  }

  const coordBuckets = new Map<string, Place[]>();
  for (const place of places) {
    if (typeof place.lat !== 'number') continue;
    const key = `${place.lat.toFixed(4)},${place.lng.toFixed(4)}`;
    const list = coordBuckets.get(key) ?? [];
    list.push(place);
    coordBuckets.set(key, list);
  }
  for (const group of coordBuckets.values()) {
    const names = new Set(group.map((place) => baseName(place.name)));
    if (group.length > 1 && names.size > 1) {
      suspectCoordinates.push(`${group.map((place) => place.name).join(' & ')} share coordinates`);
    }
  }

  return { errors, missingHours, duplicateGroups, suspectCoordinates };
}

export function validateCuratedList(places: Place[]): ValidationReport {
  return validatePlaces(
    places,
    getRecommenders().map((person) => person.id)
  );
}

export { BOOKING_KINDS };
