/**
 * Places are edited directly in data/nyc-places.json.
 * This script used to merge a CSV over the dataset and would drop
 * recommender, note, and booking fields. It now refuses to overwrite the file.
 *
 * See the README section "Editing a place".
 */
console.error(
  'Edit data/nyc-places.json directly, then run `npm run validate:places`.\n' +
    'The old CSV ingest path was retired so it cannot strip recommended_by, note, or booking.'
);
process.exit(1);
