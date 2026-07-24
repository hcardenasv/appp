/**
 * Script de prueba: encola un job de check-out inmediato para un usuario.
 * Uso: npx ts-node scripts/trigger-checkout.ts <userId>
 *
 * Si no sabes el userId, corre sin argumento y te muestra los usuarios registrados.
 */

import { Queue } from 'bullmq';
import { config } from 'dotenv';
import { resolve } from 'path';
import { Client } from 'pg';

config({ path: resolve(__dirname, '../.env') });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

function bullmqConn(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || '6379', 10),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
  };
}

async function listUsers() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(
    `SELECT user_id, display_name, email FROM users ORDER BY created_at DESC LIMIT 10`,
  );
  await client.end();
  console.log('\nUsuarios registrados:');
  rows.forEach(r => console.log(`  ${r.user_id}  ${r.display_name}  (${r.email})`));
  console.log('\nUso: npx ts-node scripts/trigger-checkout.ts <userId>');
}

async function triggerCheckout(userId: string) {
  const queue = new Queue('checkout', { connection: bullmqConn(REDIS_URL) });
  const job = await queue.add(
    'checkout',
    { userId },
    { removeOnComplete: true, removeOnFail: 3 },
  );
  console.log(`✅ Job de check-out encolado: ${job.id} para userId=${userId}`);
  console.log('   El worker lo procesará en segundos. Revisa Telegram.');
  await queue.close();
}

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    await listUsers();
  } else {
    await triggerCheckout(userId);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
