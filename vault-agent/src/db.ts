import { Pool } from 'pg';
import { config } from './config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ── Typed query helpers ──────────────────────────────────────────────────────

export interface DbUser {
  userId: string;
  displayName: string;
  timezone: string;
  workdayStart: Date;
  workdayEnd: Date;
  workDays: number[];
}

export interface DbTask {
  taskId: string;
  title: string;
  status: string;
  priority: number;
  scheduledFor: Date | null;
  dueAt: Date | null;
  deferCount: number;
  completedAt: Date | null;
  obsidianRef: { file?: string; blockId?: string } | null;
}

export interface DbDailySession {
  sessionType: string;
  status: string;
  triggeredAt: Date | null;
  completedAt: Date | null;
  summary: Record<string, unknown> | null;
}

export interface DbReport {
  reportId: string;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  metrics: Record<string, unknown>;
  obsidianPath: string | null;
  generatedAt: Date;
}

export async function getActiveUsers(): Promise<DbUser[]> {
  const { rows } = await getPool().query<{
    user_id: string; display_name: string; timezone: string;
    workday_start: Date; workday_end: Date; work_days: number[];
  }>(`SELECT user_id, display_name, timezone, workday_start, workday_end, work_days FROM users`);
  return rows.map(r => ({
    userId: r.user_id, displayName: r.display_name, timezone: r.timezone,
    workdayStart: r.workday_start, workdayEnd: r.workday_end, workDays: r.work_days,
  }));
}

export async function getTodaySession(
  userId: string,
  sessionDate: string,
  sessionType: 'CHECKIN' | 'CHECKOUT',
): Promise<DbDailySession | null> {
  const { rows } = await getPool().query<{
    session_type: string; status: string;
    triggered_at: Date | null; completed_at: Date | null;
    summary: Record<string, unknown> | null;
  }>(
    `SELECT session_type, status, triggered_at, completed_at, summary
     FROM daily_sessions
     WHERE user_id=$1 AND session_date=$2 AND session_type=$3`,
    [userId, sessionDate, sessionType],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return { sessionType: r.session_type, status: r.status, triggeredAt: r.triggered_at, completedAt: r.completed_at, summary: r.summary };
}

export async function getTodayTasks(userId: string, dateStr: string): Promise<DbTask[]> {
  const { rows } = await getPool().query<{
    task_id: string; title: string; status: string; priority: number;
    scheduled_for: Date | null; due_at: Date | null; defer_count: number;
    completed_at: Date | null; obsidian_ref: { file?: string; blockId?: string } | null;
  }>(
    `SELECT task_id, title, status, priority, scheduled_for, due_at, defer_count, completed_at, obsidian_ref
     FROM tasks
     WHERE user_id=$1 AND scheduled_for=$2
     ORDER BY priority ASC, created_at ASC`,
    [userId, dateStr],
  );
  return rows.map(r => ({
    taskId: r.task_id, title: r.title, status: r.status, priority: r.priority,
    scheduledFor: r.scheduled_for, dueAt: r.due_at, deferCount: r.defer_count,
    completedAt: r.completed_at, obsidianRef: r.obsidian_ref,
  }));
}

export async function getCarryoverTasks(userId: string, yesterdayStr: string): Promise<DbTask[]> {
  const { rows } = await getPool().query<{
    task_id: string; title: string; status: string; priority: number;
    scheduled_for: Date | null; due_at: Date | null; defer_count: number;
    completed_at: Date | null; obsidian_ref: { file?: string; blockId?: string } | null;
  }>(
    `SELECT task_id, title, status, priority, scheduled_for, due_at, defer_count, completed_at, obsidian_ref
     FROM tasks
     WHERE user_id=$1 AND scheduled_for=$2 AND status NOT IN ('DONE','CANCELLED')
     ORDER BY priority ASC`,
    [userId, yesterdayStr],
  );
  return rows.map(r => ({
    taskId: r.task_id, title: r.title, status: r.status, priority: r.priority,
    scheduledFor: r.scheduled_for, dueAt: r.due_at, deferCount: r.defer_count,
    completedAt: r.completed_at, obsidianRef: r.obsidian_ref,
  }));
}

export async function getPendingVaultReports(userId: string): Promise<DbReport[]> {
  const { rows } = await getPool().query<{
    report_id: string; period_type: string; period_start: Date; period_end: Date;
    metrics: Record<string, unknown>; obsidian_path: string | null; generated_at: Date;
  }>(
    `SELECT report_id, period_type, period_start, period_end, metrics, obsidian_path, generated_at
     FROM reports
     WHERE user_id=$1 AND obsidian_path IS NULL
     ORDER BY generated_at ASC`,
    [userId],
  );
  return rows.map(r => ({
    reportId: r.report_id, periodType: r.period_type, periodStart: r.period_start,
    periodEnd: r.period_end, metrics: r.metrics, obsidianPath: r.obsidian_path, generatedAt: r.generated_at,
  }));
}

export async function updateReportObsidianPath(reportId: string, obsidianPath: string): Promise<void> {
  await getPool().query(
    `UPDATE reports SET obsidian_path=$1 WHERE report_id=$2`,
    [obsidianPath, reportId],
  );
}

export async function createTask(
  userId: string,
  title: string,
  scheduledFor: string | null,
  dueAt: string | null,
  priority: number,
  obsidianRef: { file: string; blockId: string },
): Promise<string> {
  const { rows } = await getPool().query<{ task_id: string }>(
    `INSERT INTO tasks (user_id, task_type, title, scheduled_for, due_at, priority, obsidian_ref)
     VALUES ($1, 'PERSONAL', $2, $3, $4, $5, $6::jsonb)
     RETURNING task_id`,
    [userId, title, scheduledFor, dueAt, priority, JSON.stringify(obsidianRef)],
  );
  const taskId = rows[0].task_id;
  await getPool().query(
    `INSERT INTO task_status_history (task_id, from_status, to_status, changed_by)
     VALUES ($1, NULL, 'PENDING', 'OBSIDIAN')`,
    [taskId],
  );
  return taskId;
}

export async function markTaskDone(taskId: string, currentStatus: string): Promise<void> {
  await getPool().query(
    `UPDATE tasks SET status='DONE', completed_at=NOW(), updated_at=NOW() WHERE task_id=$1`,
    [taskId],
  );
  await getPool().query(
    `INSERT INTO task_status_history (task_id, from_status, to_status, changed_by)
     VALUES ($1, $2, 'DONE', 'OBSIDIAN')`,
    [taskId, currentStatus],
  );
}

export async function getTaskById(taskId: string): Promise<{ status: string; title: string } | null> {
  const { rows } = await getPool().query<{ status: string; title: string }>(
    `SELECT status, title FROM tasks WHERE task_id=$1`,
    [taskId],
  );
  return rows[0] ?? null;
}

export async function logVaultSync(
  direction: 'VAULT_TO_DB' | 'DB_TO_VAULT',
  filePath: string,
  entityType: string | null,
  entityId: string | null,
  action: 'CREATED' | 'UPDATED' | 'CONFLICT',
  detail: Record<string, unknown> | null,
): Promise<void> {
  await getPool().query(
    `INSERT INTO vault_sync_log (direction, file_path, entity_type, entity_id, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [direction, filePath, entityType, entityId, action, detail ? JSON.stringify(detail) : null],
  );
}
