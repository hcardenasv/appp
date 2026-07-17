import fs from 'node:fs/promises';
import path from 'node:path';
import { DbReport, updateReportObsidianPath, logVaultSync } from '../db';

type Metrics = Record<string, unknown>;

function isoWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const week = isoWeekNumber(d);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function isoWeekNumber(d: Date): number {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function monthLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}`;
}

function formatDailyReport(report: DbReport): string {
  const m  = report.metrics as Metrics;
  const ds = report.periodStart.toISOString().slice(0, 10);
  const lines: string[] = [
    `---`,
    `date: ${ds}`,
    `type: daily-report`,
    `period_start: ${ds}`,
    `generated_at: ${report.generatedAt.toISOString()}`,
    `---`,
    ``,
    `# 📊 Reporte Diario — ${ds}`,
    ``,
  ];

  const planned    = Number(m.planned)    || 0;
  const done       = Number(m.done)       || 0;
  const deferred   = Number(m.deferred)   || 0;
  const cancelled  = Number(m.cancelled)  || 0;
  const rate       = Number(m.completionRate) || 0;
  const streak     = Number(m.streak)     || 0;

  lines.push(`| Métrica | Valor |`);
  lines.push(`|---------|-------|`);
  lines.push(`| Planificadas | ${planned} |`);
  lines.push(`| ✅ Completadas | ${done} (${rate}%) |`);
  if (deferred > 0)  lines.push(`| ⏭ Postergadas | ${deferred} |`);
  if (cancelled > 0) lines.push(`| ❌ Canceladas | ${cancelled} |`);

  if (streak > 0) {
    lines.push(`| 🔥 Racha actual | ${streak} día${streak === 1 ? '' : 's'} |`);
  }

  if (Array.isArray(m.doneTaskTitles) && (m.doneTaskTitles as string[]).length > 0) {
    lines.push('');
    lines.push('**Completadas:**');
    for (const t of m.doneTaskTitles as string[]) {
      lines.push(`- ✅ ${t}`);
    }
  }

  return lines.join('\n');
}

function formatWeeklyReport(report: DbReport): string {
  const m    = report.metrics as Metrics;
  const week = isoWeekLabel(report.periodStart.toISOString().slice(0, 10));
  const ds   = report.periodStart.toISOString().slice(0, 10);
  const de   = report.periodEnd.toISOString().slice(0, 10);
  const lines: string[] = [
    `---`,
    `period: ${week}`,
    `type: weekly-report`,
    `period_start: ${ds}`,
    `period_end: ${de}`,
    `generated_at: ${report.generatedAt.toISOString()}`,
    `---`,
    ``,
    `# 📊 Resumen Semanal — ${week}`,
    ``,
  ];

  const planned    = Number(m.planned)         || 0;
  const done       = Number(m.done)            || 0;
  const deferred   = Number(m.deferred)        || 0;
  const cancelled  = Number(m.cancelled)       || 0;
  const rate       = Number(m.completionRate)  || 0;
  const prevRate   = Number(m.prevWeekRate)    || 0;
  const streak     = Number(m.streak)          || 0;
  const bestDay    = m.bestDay as string | null;

  lines.push(`| Métrica | Valor |`);
  lines.push(`|---------|-------|`);
  lines.push(`| Planificadas | ${planned} |`);
  lines.push(`| ✅ Completadas | ${done} (${rate}%) |`);
  if (deferred > 0)  lines.push(`| ⏭ Postergadas | ${deferred} |`);
  if (cancelled > 0) lines.push(`| ❌ Canceladas | ${cancelled} |`);
  if (bestDay)       lines.push(`| 📅 Mejor día | ${bestDay} |`);
  if (streak > 0)    lines.push(`| 🔥 Racha actual | ${streak} día${streak === 1 ? '' : 's'} |`);

  if (prevRate > 0) {
    const diff  = rate - prevRate;
    const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
    lines.push(`| ${arrow} vs. semana anterior | ${prevRate}% → ${rate}% (${diff > 0 ? '+' : ''}${diff}%) |`);
  }

  return lines.join('\n');
}

function formatMonthlyReport(report: DbReport): string {
  const m     = report.metrics as Metrics;
  const label = monthLabel(report.periodStart.toISOString().slice(0, 10));
  const ds    = report.periodStart.toISOString().slice(0, 10);
  const de    = report.periodEnd.toISOString().slice(0, 10);
  const lines: string[] = [
    `---`,
    `period: ${label}`,
    `type: monthly-report`,
    `period_start: ${ds}`,
    `period_end: ${de}`,
    `generated_at: ${report.generatedAt.toISOString()}`,
    `---`,
    ``,
    `# 📊 Resumen Mensual — ${label}`,
    ``,
  ];

  const planned       = Number(m.planned)        || 0;
  const done          = Number(m.done)           || 0;
  const deferred      = Number(m.deferred)       || 0;
  const cancelled     = Number(m.cancelled)      || 0;
  const rate          = Number(m.completionRate) || 0;
  const adherenceRate = Number(m.adherenceRate)  || 0;
  const bestStreak    = Number(m.bestStreak)     || 0;

  lines.push(`| Métrica | Valor |`);
  lines.push(`|---------|-------|`);
  lines.push(`| Planificadas | ${planned} |`);
  lines.push(`| ✅ Completadas | ${done} (${rate}%) |`);
  if (deferred > 0)      lines.push(`| ⏭ Postergadas | ${deferred} |`);
  if (cancelled > 0)     lines.push(`| ❌ Canceladas | ${cancelled} |`);
  if (adherenceRate > 0) lines.push(`| 📅 Adherencia ritual | ${adherenceRate}% |`);
  if (bestStreak > 0)    lines.push(`| 🔥 Mejor racha | ${bestStreak} día${bestStreak === 1 ? '' : 's'} |`);

  return lines.join('\n');
}

export async function writeReport(report: DbReport, vaultRoot: string): Promise<void> {
  let dir: string;
  let fileName: string;
  let content: string;

  if (report.periodType === 'DAILY') {
    const ds = report.periodStart.toISOString().slice(0, 10);
    dir      = path.join(vaultRoot, 'APPP', 'Reportes', 'Diario');
    fileName = `${ds}.md`;
    content  = formatDailyReport(report);
  } else if (report.periodType === 'WEEKLY') {
    const label = isoWeekLabel(report.periodStart.toISOString().slice(0, 10));
    dir      = path.join(vaultRoot, 'APPP', 'Reportes', 'Semanal');
    fileName = `${label}.md`;
    content  = formatWeeklyReport(report);
  } else if (report.periodType === 'MONTHLY') {
    const label = monthLabel(report.periodStart.toISOString().slice(0, 10));
    dir      = path.join(vaultRoot, 'APPP', 'Reportes', 'Mensual');
    fileName = `${label}.md`;
    content  = formatMonthlyReport(report);
  } else {
    return;
  }

  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  const relPath  = path.relative(vaultRoot, filePath);

  await fs.writeFile(filePath, content, 'utf-8');
  await updateReportObsidianPath(report.reportId, relPath);
  await logVaultSync('DB_TO_VAULT', relPath, 'REPORT', report.reportId, 'CREATED', { periodType: report.periodType });
}
