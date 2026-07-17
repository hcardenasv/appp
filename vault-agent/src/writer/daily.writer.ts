import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DbUser, DbTask, DbDailySession,
  getTodayTasks, getCarryoverTasks, getTodaySession,
  logVaultSync,
} from '../db';
import { localDateStr, prevDateStr, formatTime } from '../utils';

const PRIORITY_EMOJI: Record<number, string> = {
  1: '⏫', 2: '🔼', 4: '🔽', 5: '⬇️',
};

function taskToObsidianLine(task: DbTask, dateStr: string): string {
  const checked = task.status === 'DONE' ? 'x' : ' ';
  const prio    = PRIORITY_EMOJI[task.priority] ?? '';
  const due     = task.scheduledFor
    ? ` 📅 ${dateStr}`
    : task.dueAt
      ? ` 📅 ${task.dueAt.toISOString().slice(0, 10)}`
      : '';
  const id = ` [id:: ${task.taskId}]`;
  return `- [${checked}] ${task.title}${due}${prio ? ` ${prio}` : ''}${id}`;
}

function weekdayName(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-CL', { weekday: 'long', timeZone: timezone }).format(date);
}

function buildDailyNote(
  user: DbUser,
  dateStr: string,
  todayTasks: DbTask[],
  carryover: DbTask[],
  checkin: DbDailySession | null,
  checkout: DbDailySession | null,
): string {
  const localDate = new Date(dateStr + 'T12:00:00Z');
  const dayName   = weekdayName(localDate, user.timezone);
  const [y, m, d] = dateStr.split('-').map(Number);
  const monthName = new Intl.DateTimeFormat('es-CL', { month: 'long', timeZone: user.timezone }).format(localDate);

  const lines: string[] = [
    `---`,
    `date: ${dateStr}`,
    `type: daily`,
    `user_id: ${user.userId}`,
    `---`,
    ``,
    `# 📅 ${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${d} de ${monthName} de ${y}`,
    ``,
  ];

  // ── Morning brief ────────────────────────────────────────────────────────
  const checkinTime = checkin?.triggeredAt
    ? formatTime(checkin.triggeredAt, user.timezone)
    : '–';
  lines.push(`## 🌅 Brief matutino (${checkinTime})`);
  lines.push('');

  const activeToday = todayTasks.filter(t => !['DONE', 'CANCELLED'].includes(t.status));
  if (activeToday.length > 0) {
    lines.push(`**${activeToday.length} tarea${activeToday.length === 1 ? '' : 's'} para hoy:**`);
    lines.push('');
    for (const t of activeToday) {
      lines.push(taskToObsidianLine(t, dateStr));
    }
  } else {
    lines.push('*Sin tareas planificadas para hoy.*');
  }

  if (carryover.length > 0) {
    lines.push('');
    const titles = carryover.map(t => t.title).join(', ');
    lines.push(`*Arrastre de ayer (${carryover.length}):* ${titles}`);
  }

  const stuck = todayTasks.filter(t => t.deferCount >= 3 && !['DONE', 'CANCELLED'].includes(t.status));
  if (stuck.length > 0) {
    lines.push('');
    lines.push('*⚠️ Atascadas (≥3 postergaciones):*');
    for (const t of stuck) {
      lines.push(`- ${t.title} [${t.deferCount}x]`);
    }
  }
  lines.push('');

  // ── Evening acta ─────────────────────────────────────────────────────────
  if (checkout && checkout.status === 'COMPLETED') {
    const checkoutTime = checkout.completedAt
      ? formatTime(checkout.completedAt, user.timezone)
      : '–';
    lines.push('---');
    lines.push('');
    lines.push(`## 🌆 Acta del check-out (${checkoutTime})`);
    lines.push('');

    const done      = todayTasks.filter(t => t.status === 'DONE');
    const deferred  = todayTasks.filter(t => t.status === 'DEFERRED');
    const cancelled = todayTasks.filter(t => t.status === 'CANCELLED');

    if (done.length > 0)      lines.push(`✅ **Completadas (${done.length}):** ${done.map(t => t.title).join(', ')}`);
    if (deferred.length > 0)  lines.push(`⏭ **Postergadas (${deferred.length}):** ${deferred.map(t => t.title).join(', ')}`);
    if (cancelled.length > 0) lines.push(`❌ **Canceladas (${cancelled.length}):** ${cancelled.map(t => t.title).join(', ')}`);

    const summary = checkout.summary as { done?: number; total?: number; completionRate?: number } | null;
    if (summary?.completionRate !== undefined) {
      lines.push('');
      lines.push(`📊 **Tasa de completitud:** ${summary.completionRate}%`);
    } else if (todayTasks.length > 0) {
      const rate = Math.round(done.length / todayTasks.length * 100);
      lines.push('');
      lines.push(`📊 **Tasa de completitud:** ${rate}%`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function writeDailyNote(user: DbUser, vaultRoot: string, dateStr: string): Promise<void> {
  const yesterday = prevDateStr(dateStr);

  const [todayTasks, carryover, checkin, checkout] = await Promise.all([
    getTodayTasks(user.userId, dateStr),
    getCarryoverTasks(user.userId, yesterday),
    getTodaySession(user.userId, dateStr, 'CHECKIN'),
    getTodaySession(user.userId, dateStr, 'CHECKOUT'),
  ]);

  // Only write if there's something to write (checkin triggered or tasks exist)
  if (!checkin && todayTasks.length === 0) return;

  const content  = buildDailyNote(user, dateStr, todayTasks, carryover, checkin, checkout);
  const dir      = path.join(vaultRoot, 'APPP', 'Diario');
  const filePath = path.join(dir, `${dateStr}.md`);
  const relPath  = path.join('APPP', 'Diario', `${dateStr}.md`);

  await fs.mkdir(dir, { recursive: true });

  let action: 'CREATED' | 'UPDATED' = 'CREATED';
  try {
    await fs.access(filePath);
    action = 'UPDATED';
  } catch {
    // file doesn't exist yet
  }

  await fs.writeFile(filePath, content, 'utf-8');
  await logVaultSync('DB_TO_VAULT', relPath, 'SESSION', null, action, { date: dateStr, userId: user.userId });
}

export function getTodayDateStr(timezone: string): string {
  return localDateStr(timezone);
}
