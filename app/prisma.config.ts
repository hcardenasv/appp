import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { config as loadEnv } from 'dotenv';

// El .env vive en la raíz del monorepo (un nivel arriba de app/)
loadEnv({ path: path.resolve(process.cwd(), '../.env') });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
