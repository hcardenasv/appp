import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TelegramSenderService } from '../proactivity/telegram-sender.service';
import { EngagementService } from '../proactivity/engagement.service';
import { localDayRange, localDateAsUtcMidnight, localWeekBounds, localMonthBounds } from '../../utils/timezone';
import { ENGAGEMENT_STATES } from '../proactivity/proactivity.constants';

export interface DailyMetrics {
  planned:          number;
  done:             number;
  deferred:         number;
  cancelled:        number;
  completionRate:   number;
  doneTaskTitles:   string[];
  pendingStillOpen: number;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma:             PrismaService,
    private readonly telegramSender:     TelegramSenderService,
    private readonly engagementService:  EngagementService,
  ) {}

  /**
   * Llamado desde BotService después de cada callback de check-out.
   * Si todas las tareas del día quedaron resueltas, cierra la sesión y envía el reporte.
   */
  async tryCloseCheckout(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { userId } });
    if (!user) return;

    const sessionDate = localDateAsUtcMidnight(user.timezone);

    const session = await this.prisma.dailySession.findUnique({
      where: { userId_sessionDate_sessionType: { userId, sessionDate, sessionType: 'CHECKOUT' } },
    });
    if (!session || session.status === 'COMPLETED') return;

    const { gte, lt } = localDayRange(user.timezone, 0);
    const openCount = await this.prisma.task.count({
      where: {
        userId,
        scheduledFor: { gte, lt },
        status: { notIn: ['DONE', 'CANCELLED', 'DEFERRED'] },
      },
    });
    if (openCount > 0) return;

    await this.generateAndSend(userId, user, sessionDate, false);
  }

  /**
   * Genera, persiste y envía el reporte diario por Telegram.
   * Si `missed=true`, la sesión de check-out se marca como MISSED.
   */
  async generateAndSend(
    userId: string,
    user: User | null,
    sessionDate: Date,
    missed: boolean,
  ): Promise<void> {
    const resolvedUser = user ?? await this.prisma.user.findUnique({ where: { userId } });
    if (!resolvedUser) return;

    // Idempotencia: no reenviar si el reporte ya existe
    const existing = await this.prisma.report.findUnique({
      where: { userId_periodType_periodStart: { userId, periodType: 'DAILY', periodStart: sessionDate } },
    });
    if (existing) return;

    const metrics = await this.calculateMetrics(userId, resolvedUser.timezone);
    const streak  = await this.calculateStreak(userId, resolvedUser.timezone);

    // Cerrar sesión de check-out
    await this.prisma.dailySession.updateMany({
      where: { userId, sessionDate, sessionType: 'CHECKOUT', status: { not: 'COMPLETED' } },
      data: {
        status:      missed ? 'MISSED' : 'COMPLETED',
        completedAt: missed ? null : new Date(),
        summary:     { planned: metrics.planned, done: metrics.done, streak } as Prisma.InputJsonValue,
      },
    });

    // Persistir reporte
    await this.prisma.report.create({
      data: {
        userId,
        periodType:  'DAILY',
        periodStart: sessionDate,
        periodEnd:   sessionDate,
        metrics:     { ...metrics, streak } as Prisma.InputJsonValue,
      },
    });

    // Enviar por Telegram
    const chatId = await this.telegramSender.getChatId(this.prisma, userId);
    if (chatId) {
      const message = this.formatReport(resolvedUser, metrics, streak, missed);
      await this.telegramSender.sendText(chatId, message, { parse_mode: 'Markdown' });
    }

    // Transición de estado
    await this.engagementService.transitionState(userId, ENGAGEMENT_STATES.IDLE);
    this.logger.log(`Reporte diario enviado para ${userId} (missed=${missed})`);
  }

  async calculateMetrics(userId: string, timezone: string): Promise<DailyMetrics> {
    const { gte, lt } = localDayRange(timezone, 0);

    const scheduledTasks = await this.prisma.task.findMany({
      where: { userId, scheduledFor: { gte, lt } },
      select: { title: true, status: true },
    });

    const planned          = scheduledTasks.length;
    const done             = scheduledTasks.filter(t => t.status === 'DONE').length;
    const deferred         = scheduledTasks.filter(t => t.status === 'DEFERRED').length;
    const cancelled        = scheduledTasks.filter(t => t.status === 'CANCELLED').length;
    const pendingStillOpen = scheduledTasks.filter(
      t => !['DONE', 'CANCELLED', 'DEFERRED'].includes(t.status),
    ).length;
    const doneTaskTitles   = scheduledTasks.filter(t => t.status === 'DONE').map(t => t.title);
    const completionRate   = planned > 0 ? Math.round((done / planned) * 100) : 0;

    return { planned, done, deferred, cancelled, completionRate, doneTaskTitles, pendingStillOpen };
  }

  async calculateStreak(userId: string, timezone: string): Promise<number> {
    const sessions = await this.prisma.dailySession.findMany({
      where: { userId, status: 'COMPLETED' },
      select: { sessionDate: true, sessionType: true },
      orderBy: { sessionDate: 'desc' },
      take: 120,
    });

    // Construir set de fechas con ambas sesiones completadas
    const byDate = new Map<string, Set<string>>();
    for (const s of sessions) {
      const key = s.sessionDate.toISOString().slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, new Set());
      byDate.get(key)!.add(s.sessionType);
    }
    const completeDays = new Set(
      [...byDate.entries()]
        .filter(([, types]) => types.has('CHECKIN') && types.has('CHECKOUT'))
        .map(([date]) => date),
    );

    // Contar días consecutivos hacia atrás desde hoy (inclusive)
    const todayStr = new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(new Date());
    let streak = 0;
    const cur = new Date(`${todayStr}T00:00:00Z`);

    while (completeDays.has(cur.toISOString().slice(0, 10))) {
      streak++;
      cur.setUTCDate(cur.getUTCDate() - 1);
    }
    return streak;
  }

  // ──────────────────────────────────────────────────────────────────
  // Reportes periódicos (semanal / mensual)
  // ──────────────────────────────────────────────────────────────────

  async generateWeeklyReport(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { userId } });
    if (!user) return;

    const current  = localWeekBounds(user.timezone, 0);
    const previous = localWeekBounds(user.timezone, -1);
    const periodStart = current.dateGte;

    const existing = await this.prisma.report.findUnique({
      where: { userId_periodType_periodStart: { userId, periodType: 'WEEKLY', periodStart } },
    });
    if (existing) return;

    const curMetrics  = await this.calcPeriodMetrics(userId, current);
    const prevMetrics = await this.calcPeriodMetrics(userId, previous);
    const streak      = await this.calculateStreak(userId, user.timezone);

    await this.prisma.report.create({
      data: {
        userId, periodType: 'WEEKLY',
        periodStart, periodEnd: new Date(current.dateLt.getTime() - 86_400_000),
        metrics: { ...curMetrics, prevWeekRate: prevMetrics.completionRate, streak } as Prisma.InputJsonValue,
      },
    });

    const chatId = await this.telegramSender.getChatId(this.prisma, userId);
    if (chatId) {
      const text = this.formatWeeklyReport(user, curMetrics, prevMetrics.completionRate, streak, current.label);
      await this.telegramSender.sendText(chatId, text, { parse_mode: 'Markdown' });
    }
    this.logger.log(`Reporte semanal enviado para ${userId} (${current.label})`);
  }

  async generateMonthlyReport(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { userId } });
    if (!user) return;

    const period = localMonthBounds(user.timezone, 0);
    const periodStart = period.dateGte;

    const existing = await this.prisma.report.findUnique({
      where: { userId_periodType_periodStart: { userId, periodType: 'MONTHLY', periodStart } },
    });
    if (existing) return;

    const metrics       = await this.calcPeriodMetrics(userId, period);
    const adherenceRate = await this.calcAdherenceRate(userId, period.dateGte, period.dateLt);
    const bestStreak    = await this.calcBestStreak(userId, period.dateGte, period.dateLt);

    await this.prisma.report.create({
      data: {
        userId, periodType: 'MONTHLY',
        periodStart, periodEnd: new Date(period.dateLt.getTime() - 86_400_000),
        metrics: { ...metrics, adherenceRate, bestStreak } as Prisma.InputJsonValue,
      },
    });

    const chatId = await this.telegramSender.getChatId(this.prisma, userId);
    if (chatId) {
      const text = this.formatMonthlyReport(user, metrics, adherenceRate, bestStreak, period.label);
      await this.telegramSender.sendText(chatId, text, { parse_mode: 'Markdown' });
    }
    this.logger.log(`Reporte mensual enviado para ${userId} (${period.label})`);
  }

  async calcPeriodMetrics(
    userId: string,
    range: { gte: Date; lt: Date; dateGte: Date; dateLt: Date },
  ): Promise<{ planned: number; done: number; deferred: number; cancelled: number; completionRate: number; bestDay: string | null }> {
    const tasks = await this.prisma.task.findMany({
      where: { userId, scheduledFor: { gte: range.dateGte, lt: range.dateLt } },
      select: { status: true, completedAt: true },
    });

    const planned    = tasks.length;
    const done       = tasks.filter(t => t.status === 'DONE').length;
    const deferred   = tasks.filter(t => t.status === 'DEFERRED').length;
    const cancelled  = tasks.filter(t => t.status === 'CANCELLED').length;
    const completionRate = planned > 0 ? Math.round(done / planned * 100) : 0;

    const byDay = new Map<string, number>();
    for (const t of tasks.filter(t => t.status === 'DONE' && t.completedAt)) {
      const day = new Intl.DateTimeFormat('es-CL', { weekday: 'long' }).format(t.completedAt!);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const bestDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return { planned, done, deferred, cancelled, completionRate, bestDay };
  }

  private async calcAdherenceRate(userId: string, dateGte: Date, dateLt: Date): Promise<number> {
    const sessions = await this.prisma.dailySession.findMany({
      where: { userId, sessionDate: { gte: dateGte, lt: dateLt } },
      select: { status: true },
    });
    if (sessions.length === 0) return 0;
    const completed = sessions.filter(s => s.status === 'COMPLETED').length;
    return Math.round(completed / sessions.length * 100);
  }

  private async calcBestStreak(userId: string, dateGte: Date, dateLt: Date): Promise<number> {
    const sessions = await this.prisma.dailySession.findMany({
      where: { userId, status: 'COMPLETED', sessionDate: { gte: dateGte, lt: dateLt } },
      select: { sessionDate: true, sessionType: true },
      orderBy: { sessionDate: 'asc' },
    });

    const byDate = new Map<string, Set<string>>();
    for (const s of sessions) {
      const key = s.sessionDate.toISOString().slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, new Set());
      byDate.get(key)!.add(s.sessionType);
    }

    const completeDays = [...byDate.entries()]
      .filter(([, types]) => types.has('CHECKIN') && types.has('CHECKOUT'))
      .map(([date]) => new Date(date + 'T00:00:00Z'))
      .sort((a, b) => a.getTime() - b.getTime());

    if (completeDays.length === 0) return 0;

    let maxStreak = 1, cur = 1;
    for (let i = 1; i < completeDays.length; i++) {
      const diffDays = (completeDays[i].getTime() - completeDays[i - 1].getTime()) / 86_400_000;
      cur = diffDays === 1 ? cur + 1 : 1;
      if (cur > maxStreak) maxStreak = cur;
    }
    return maxStreak;
  }

  formatWeeklyReport(
    user: User,
    metrics: { planned: number; done: number; deferred: number; cancelled: number; completionRate: number; bestDay: string | null },
    prevRate: number,
    streak: number,
    label: string,
  ): string {
    const name  = user.displayName.split(' ')[0];
    const lines: string[] = [];
    lines.push(`📊 *Resumen semanal — ${label}*`);
    lines.push('');

    if (metrics.planned === 0) {
      lines.push('No hubo tareas planificadas esta semana.');
    } else {
      lines.push(`✅ Completadas: ${metrics.done} de ${metrics.planned} (${metrics.completionRate}%)`);
      if (metrics.deferred > 0)  lines.push(`⏭ Postergadas: ${metrics.deferred}`);
      if (metrics.cancelled > 0) lines.push(`❌ Canceladas: ${metrics.cancelled}`);
      if (metrics.bestDay) {
        lines.push('');
        lines.push(`📅 *Mejor día:* ${metrics.bestDay}`);
      }
      if (prevRate > 0) {
        const diff  = metrics.completionRate - prevRate;
        const trend = diff > 0 ? `+${diff}%` : `${diff}%`;
        const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
        lines.push(`${arrow} vs. semana pasada: ${prevRate}% → ${metrics.completionRate}% (${trend})`);
      }
    }

    if (streak > 0) {
      lines.push('');
      lines.push(`🔥 *Racha actual:* ${streak} día${streak === 1 ? '' : 's'}`);
    }
    lines.push('');
    lines.push(metrics.completionRate >= 80
      ? `¡Excelente semana, ${name}! 💪`
      : metrics.completionRate >= 50
        ? `Buena semana, ${name}. ¡A seguir! 👋`
        : `La próxima semana mejor, ${name}. ¡Ánimo! 💪`);
    return lines.join('\n');
  }

  formatMonthlyReport(
    user: User,
    metrics: { planned: number; done: number; deferred: number; cancelled: number; completionRate: number; bestDay: string | null },
    adherenceRate: number,
    bestStreak: number,
    label: string,
  ): string {
    const name  = user.displayName.split(' ')[0];
    const lines: string[] = [];
    lines.push(`📊 *Resumen mensual — ${label}*`);
    lines.push('');

    if (metrics.planned === 0) {
      lines.push('No hubo tareas planificadas este mes.');
    } else {
      lines.push(`✅ Completadas: ${metrics.done} de ${metrics.planned} (${metrics.completionRate}%)`);
      if (metrics.deferred > 0)  lines.push(`⏭ Postergadas: ${metrics.deferred}`);
      if (metrics.cancelled > 0) lines.push(`❌ Canceladas: ${metrics.cancelled}`);
    }

    if (adherenceRate > 0) {
      lines.push('');
      lines.push(`📅 *Adherencia al ritual:* ${adherenceRate}%`);
    }
    if (bestStreak > 0) {
      lines.push(`🔥 *Mejor racha del mes:* ${bestStreak} día${bestStreak === 1 ? '' : 's'}`);
    }
    lines.push('');
    lines.push(metrics.completionRate >= 80
      ? `¡Excelente mes, ${name}! 🌟`
      : metrics.completionRate >= 50
        ? `Buen mes, ${name}. ¡Seguimos! 💪`
        : `El próximo mes lo superamos, ${name}. 👋`);
    return lines.join('\n');
  }

  formatReport(user: User, metrics: DailyMetrics, streak: number, missed: boolean): string {
    const name = user.displayName.split(' ')[0];
    const todayStr = new Intl.DateTimeFormat('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: user.timezone,
    }).format(new Date());

    const lines: string[] = [];
    lines.push(`📊 *Reporte del día — ${todayStr}*`);
    lines.push('');

    if (missed) {
      lines.push('_No se completó el check-out de hoy._');
      lines.push('');
    }

    if (metrics.planned === 0) {
      lines.push('No había tareas planificadas para hoy.');
    } else {
      lines.push(`✅ Completadas: ${metrics.done} de ${metrics.planned} (${metrics.completionRate}%)`);
      if (metrics.deferred > 0)         lines.push(`⏭ Postergadas: ${metrics.deferred}`);
      if (metrics.cancelled > 0)        lines.push(`❌ Canceladas: ${metrics.cancelled}`);
      if (metrics.pendingStillOpen > 0) lines.push(`⏳ Sin cerrar: ${metrics.pendingStillOpen}`);

      if (metrics.doneTaskTitles.length > 0) {
        lines.push('');
        lines.push('📌 *Logros de hoy:*');
        metrics.doneTaskTitles.slice(0, 5).forEach(t => lines.push(`  • ${t}`));
      }
    }

    if (streak > 0) {
      lines.push('');
      const días = streak === 1 ? 'día' : 'días';
      lines.push(`🔥 *Racha:* ${streak} ${días} consecutivo${streak === 1 ? '' : 's'} con check-in y check-out`);
    }

    lines.push('');
    if (missed) {
      lines.push(`Hasta mañana, ${name}. 👋`);
    } else if (metrics.completionRate >= 80) {
      lines.push(`¡Excelente día, ${name}! 💪 Hasta mañana.`);
    } else if (metrics.completionRate >= 50) {
      lines.push(`Buen trabajo, ${name}. ¡Mañana más! 👋`);
    } else {
      lines.push(`Hasta mañana, ${name}. Mañana es otro día. 👋`);
    }

    return lines.join('\n');
  }
}
