import { getActiveUsers, getPendingVaultReports } from './db';
import { writeDailyNote } from './writer/daily.writer';
import { writeReport } from './writer/report.writer';
import { localDateStr } from './utils';

const logger = {
  log:   (msg: string) => console.log(`[${new Date().toISOString()}] [sync] ${msg}`),
  error: (msg: string, err?: unknown) => console.error(`[${new Date().toISOString()}] [sync] ERROR ${msg}`, err ?? ''),
};

export async function runSync(vaultRoot: string): Promise<void> {
  let users;
  try {
    users = await getActiveUsers();
  } catch (err) {
    logger.error('No se pudo obtener usuarios', err);
    return;
  }

  for (const user of users) {
    try {
      const today = localDateStr(user.timezone);

      // Write / update today's daily note
      await writeDailyNote(user, vaultRoot, today);

      // Write any pending reports (obsidian_path = NULL)
      const reports = await getPendingVaultReports(user.userId);
      for (const report of reports) {
        await writeReport(report, vaultRoot);
        logger.log(`Reporte ${report.periodType} escrito: ${report.periodStart.toISOString().slice(0, 10)}`);
      }
    } catch (err) {
      logger.error(`Error en sync para usuario ${user.userId}`, err);
    }
  }
}

export function startPeriodicSync(vaultRoot: string, intervalMs: number): NodeJS.Timeout {
  logger.log(`Sincronización periódica cada ${intervalMs / 1000}s — vault: ${vaultRoot}`);

  // Initial sync
  void runSync(vaultRoot).catch(err => logger.error('Error en sync inicial', err));

  return setInterval(() => {
    void runSync(vaultRoot).catch(err => logger.error('Error en sync periódico', err));
  }, intervalMs);
}
