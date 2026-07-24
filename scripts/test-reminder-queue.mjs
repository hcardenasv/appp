// Script de diagnóstico: intenta encolar un reminder de prueba en BullMQ
import { Queue } from 'bullmq';
import { createClient } from 'redis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Leer .env manualmente
const envPath = resolve(process.cwd(), '../.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf-8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const redisUrl = env.REDIS_URL ?? 'redis://localhost:6379';
console.log('[test] REDIS_URL:', redisUrl);

const u = new URL(redisUrl);
const conn = {
  host: u.hostname,
  port: parseInt(u.port || '6379', 10),
  ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
};

console.log('[test] Conectando a Redis:', conn);

const queue = new Queue('reminders', { connection: conn });

try {
  const job = await queue.add('fire-reminder', { reminderId: 'test-diag-123' }, {
    delay: 0,
    jobId: 'reminder:test-diag-123',
    removeOnComplete: true,
    removeOnFail: 3,
  });
  console.log('[test] ✅ Job encolado con ID:', job.id);
} catch (err) {
  console.error('[test] ❌ Error al encolar:', err.message);
  console.error(err);
} finally {
  await queue.close();
  console.log('[test] Cola cerrada.');
}
