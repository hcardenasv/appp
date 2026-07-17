import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: path.resolve(__dirname, '../../.env') });

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Env var ${key} is required`);
  return v;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  vaultPath:   process.env.VAULT_PATH ?? '/vault',
  syncIntervalMs: parseInt(process.env.VAULT_SYNC_INTERVAL_MS ?? '60000', 10),
  apppSubdir:  'APPP',
};
