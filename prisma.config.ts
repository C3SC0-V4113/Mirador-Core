import 'dotenv/config';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url:
      process.env.DATABASE_URL_MIGRATION ??
      'postgresql://postgres:postgres@localhost:5432/mirador_core',
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
