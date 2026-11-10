import { getPlaces, type Place } from './places';

/** Curated NYC list. Same array the slot planner uses. */
export function getPlacesDataset(): Place[] {
  return getPlaces();
}

export const placesDataset: Place[] = getPlaces();
