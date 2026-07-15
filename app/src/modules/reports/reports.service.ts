import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TelegramSenderService } from '../proactivity/telegram-sender.service';
import { EngagementService } from '../proactivity/engagement.service';
import { localDayRange, localDateAsUtcMidnight } from '../../utils/timezone';
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
