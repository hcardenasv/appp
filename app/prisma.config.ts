import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { config as loadEnv } from 'dotenv';

// En dev el .env está un nivel arriba (monorepo); en Docker viene como env var directa.
// dotenv no lanza error si el archivo no existe.
loadEnv({ path: path.resolve(process.cwd(), '../.env') });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
});
