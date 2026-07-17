import { config } from './config';
import { closePool, getActiveUsers } from './db';
import { startPeriodicSync } from './sync';
import { startVaultWatcher } from './watcher/vault.watcher';
import fs from 'node:fs/promises';
import path from 'node:path';

const logger = {
  log:   (msg: string) => console.log(`[${new Date().toISOString()}] [vault-agent] ${msg}`),
  error: (msg: string, err?: unknown) => console.error(`[${new Date().toISOString()}] [vault-agent] ERROR ${msg}`, err ?? ''),
};

async function ensureVaultStructure(vaultRoot: string): Promise<void> {
  const dirs = [
    path.join(vaultRoot, 'APPP'),
    path.join(vaultRoot, 'APPP', 'Diario'),
    path.join(vaultRoot, 'APPP', 'Proyectos'),
    path.join(vaultRoot, 'APPP', 'Reportes', 'Diario'),
    path.join(vaultRoot, 'APPP', 'Reportes', 'Semanal'),
    path.join(vaultRoot, 'APPP', 'Reportes', 'Mensual'),
    path.join(vaultRoot, 'APPP', '_sistema'),
  ];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  // Ensure 00-Inbox.md exists
  const inbox = path.join(vaultRoot, 'APPP', '00-Inbox.md');
  try {
    await fs.access(inbox);
  } catch {
    await fs.writeFile(
      inbox,
      '# 📥 Bandeja de entrada\n\nEscribe tareas aquí y serán sincronizadas automáticamente.\n\n' +
      '**Formato:** `- [ ] Tarea 📅 YYYY-MM-DD`\n',
      'utf-8',
    );
  }
}

async function main(): Promise<void> {
  logger.log(`Iniciando vault-agent — vault: ${config.vaultPath}`);

  await ensureVaultStructure(config.vaultPath);

  // Start periodic sync (DB → vault)
  const syncTimer = startPeriodicSync(config.vaultPath, config.syncIntervalMs);

  // Get the first active user for watcher (multi-user: start one watcher per user)
  let watchers: Awaited<ReturnType<typeof startVaultWatcher>>[] = [];
  try {
    const users = await getActiveUsers();
    if (users.length === 0) {
      logger.log('Sin usuarios activos — watcher no iniciado. Se reintentará en el próximo ciclo.');
    } else {
      for (const user of users) {
        const w = startVaultWatcher(config.vaultPath, user.userId);
        watchers.push(w);
        logger.log(`Watcher iniciado para usuario ${user.displayName} (${user.userId})`);
      }
    }
  } catch (err) {
    logger.error('Error al iniciar watcher', err);
  }

  async function shutdown() {
    logger.log('Deteniendo vault-agent…');
    clearInterval(syncTimer);
    for (const w of watchers) {
      await w.close();
    }
    await closePool();
    logger.log('Vault-agent detenido.');
    process.exit(0);
  }

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT',  () => { void shutdown(); });
}

main().catch(err => {
  console.error('[vault-agent] Error fatal', err);
  process.exit(1);
});
