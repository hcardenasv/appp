import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EngagementService } from './engagement.service';
import { TelegramSenderService } from './telegram-sender.service';
import { localDateAsUtcMidnight, localDayRange } from '../../utils/timezone';
import { ENGAGEMENT_STATES } from './proactivity.constants';

@Injectable()
export class CheckinProcessor {
  private readonly logger = new Logger(CheckinProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engagementService: EngagementService,
    private readonly telegramSender: TelegramSenderService,
  ) {}

  async process(job: Job<{ userId: string }>): Promise<void> {
    const { userId } = job.data;
    const user = await this.prisma.user.findUnique({ where: { userId } });
    if (!user) {
      this.logger.warn(`Check-in: usuario ${userId} no encontrado`);
      return;
    }

    const sessionDate = localDateAsUtcMidnight(user.timezone);

    // Idempotencia: si ya existe la sesión no pendiente, abortar
    const existing = await this.prisma.dailySession.findUnique({
      where: { userId_sessionDate_sessionType: { userId, sessionDate, sessionType: 'CHECKIN' } },
    });
    if (existing && existing.status !== 'PENDING') {
      this.logger.log(`Check-in de ${userId} ya procesado (${existing.status}), saltando`);
      return;
    }

    // Crear / marcar la sesión como TRIGGERED
    await this.prisma.dailySession.upsert({
      where: { userId_sessionDate_sessionType: { userId, sessionDate, sessionType: 'CHECKIN' } },
      create: { userId, sessionDate, sessionType: 'CHECKIN', status: 'TRIGGERED', triggeredAt: new Date() },
      update: { status: 'TRIGGERED', triggeredAt: new Date() },
    });

    // Componer brief y enviar por Telegram
    const brief = await this.composeBrief(user);
    const chatId = await this.telegramSender.getChatId(this.prisma, userId);
    if (chatId) {
      await this.telegramSender.sendText(chatId, brief);
    } else {
      this.logger.warn(`Check-in: sin canal Telegram para ${userId}`);
    }

    // Actualizar engagement
    await this.engagementService.transitionState(userId, ENGAGEMENT_STATES.AWAITING_CHECKIN);
    this.logger.log(`Check-in disparado para ${userId}`);
  }

  private async composeBrief(user: User): Promise<string> {
    const today     = localDayRange(user.timezone, 0);
    const yesterday = localDayRange(user.timezone, -1);

    const [carryover, todayTasks, stuck] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          userId: user.userId,
          scheduledFor: { gte: yesterday.gte, lt: yesterday.lt },
          status: { notIn: ['DONE', 'CANCELLED'] },
        },
        orderBy: { priority: 'asc' },
        take: 10,
      }),
      this.prisma.task.findMany({
        where: {
          userId: user.userId,
          OR: [
            { scheduledFor: { gte: today.gte, lt: today.lt } },
            { dueAt: { gte: today.gte, lt: today.lt } },
          ],
          status: { notIn: ['DONE', 'CANCELLED'] },
        },
        orderBy: { priority: 'asc' },
        take: 15,
      }),
      this.prisma.task.findMany({
        where: {
          userId: user.userId,
          deferCount: { gte: 3 },
          status: { notIn: ['DONE', 'CANCELLED'] },
        },
        orderBy: { deferCount: 'desc' },
        take: 5,
      }),
    ]);

    const name  = user.displayName.split(' ')[0];
    const lines = [`🌅 Buenos días, ${name}!`];

    if (carryover.length > 0) {
      lines.push(`\n📦 *Arrastre de ayer* (${carryover.length}):`);
      carryover.forEach((t) => lines.push(`  • ${t.title}`));
    }

    if (todayTasks.length > 0) {
      lines.push(`\n📋 *Para hoy* (${todayTasks.length}):`);
      todayTasks.forEach((t) => {
        const due = t.dueAt
          ? ` ⏰ ${t.dueAt.toLocaleTimeString('es-CL', {
              timeZone: user.timezone,
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : '';
        lines.push(`  • P${t.priority} ${t.title}${due}`);
      });
    }

    if (stuck.length > 0) {
      lines.push(`\n⚠️ *Atascadas* (≥3 postergaciones):`);
      stuck.forEach((t) => lines.push(`  • ${t.title} [${t.deferCount}x]`));
    }

    if (carryover.length === 0 && todayTasks.length === 0) {
      lines.push('\n✨ No tienes tareas pendientes. ¡Día despejado!');
    }

    lines.push('\n_Escríbeme en lenguaje natural para organizar tu día._');
    return lines.join('\n');
  }
}
