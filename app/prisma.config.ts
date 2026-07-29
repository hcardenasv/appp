import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { config as loadEnv } from 'dotenv';

// En dev el .env está un nivel arriba (monorepo); en Docker viene como env var directa.
// dotenv no lanza error si el archivo no existe.
loadEnv({ path: path.resolve(process.cwd(), '../.env') });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    // En Docker build no hay BD real; el placeholder permite que prisma generate funcione.
    // En runtime, DATABASE_URL proviene de docker-compose (sobreescribe cualquier .env).
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
