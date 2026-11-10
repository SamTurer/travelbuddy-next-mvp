import { getPlaces } from '../lib/places';
import { validateCuratedList } from '../lib/validate-places';

const strict = process.argv.includes('--strict');
const report = validateCuratedList(getPlaces());

console.log(`Places: ${getPlaces().length}`);
console.log(`Errors: ${report.errors.length}`);
console.log(`Missing hours: ${report.missingHours.length}`);
console.log(`Near-duplicate groups: ${report.duplicateGroups.length}`);
console.log(`Shared coordinates (different places): ${report.suspectCoordinates.length}`);

for (const error of report.errors) console.error(`ERROR ${error}`);
if (report.missingHours.length) {
  console.log('Missing hours:');
  for (const name of report.missingHours) console.log(`  - ${name}`);
}
if (report.suspectCoordinates.length) {
  console.log('Suspect coordinates:');
  for (const line of report.suspectCoordinates) console.log(`  - ${line}`);
}

if (report.errors.length) process.exit(1);
if (strict && (report.missingHours.length || report.suspectCoordinates.length)) process.exit(1);
