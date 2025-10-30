import { PrismaClient } from '@prisma/client';
import { getPlacesDataset } from '../lib/places-dataset';

const prisma = new PrismaClient();

async function main() {
  const data = getPlacesDataset();
  for (const p of data) {
    await prisma.place.create({
      data: {
        name: p.name,
        category: p.category,
        neighborhood: p.neighborhood,
        energyTags: p.energy_tags,
        vibeTags: p.vibe_tags,
        durationMin: p.duration_min,
        expertSnippet: p.description,
        source: 'Seed',
      }
    });
  }
  console.log('Seeded', data.length, 'places');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
