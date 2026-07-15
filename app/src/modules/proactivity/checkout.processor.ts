import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EngagementService } from './engagement.service';
import { TelegramSenderService } from './telegram-sender.service';
import { QueueService } from './queue.service';
import { localDateAsUtcMidnight, localDayRange } from '../../utils/timezone';
import { ENGAGEMENT_STATES, JOB_NAMES } from './proactivity.constants';

const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class CheckoutProcessor {
  private readonly logger = new Logger(CheckoutProcessor.name);

  constructor(
    private readonly prisma:             PrismaService,
    private readonly engagementService:  EngagementService,
    private readonly telegramSender:     TelegramSenderService,
    private readonly queueService:       QueueService,
  ) {}

  async process(job: Job<{ userId: string }>): Promise<void> {
    const { userId } = job.data;
    const user = await this.prisma.user.findUnique({ where: { userId } });
    if (!user) return;

    const sessionDate = localDateAsUtcMidnight(user.timezone);

    const existing = await this.prisma.dailySession.findUnique({
      where: { userId_sessionDate_sessionType: { userId, sessionDate, sessionType: 'CHECKOUT' } },
    });
    if (existing && existing.status !== 'PENDING') return;

    await this.prisma.dailySession.upsert({
      where: { userId_sessionDate_sessionType: { userId, sessionDate, sessionType: 'CHECKOUT' } },
      create: { userId, sessionDate, sessionType: 'CHECKOUT', status: 'TRIGGERED', triggeredAt: new Date() },
      update: { status: 'TRIGGERED', triggeredAt: new Date() },
    });

    const chatId = await this.telegramSender.getChatId(this.prisma, userId);
    if (!chatId) {
      this.logger.warn(`Check-out: sin canal Telegram para ${userId}`);
      return;
    }

    const today = localDayRange(user.timezone, 0);
    const todayTasks = await this.prisma.task.findMany({
      where: {
        userId,
        scheduledFor: { gte: today.gte, lt: today.lt },
        status: { notIn: ['DONE', 'CANCELLED'] },
      },
      orderBy: { priority: 'asc' },
    });

    const name = user.displayName.split(' ')[0];

    if (todayTasks.length === 0) {
      await this.telegramSender.sendText(
        chatId,
        `🎉 ¡Buen trabajo, ${name}! Todas las tareas de hoy están cerradas. Disfruta el resto del día.`,
      );
      await this.completeSession(userId, sessionDate, { completed: 0, total: 0 });
      await this.engagementService.transitionState(userId, ENGAGEMENT_STATES.IDLE);
      return;
    }

    await this.telegramSender.sendText(
      chatId,
      `🌆 ¡Hora de cerrar el día, ${name}! Revisemos tus ${todayTasks.length} tarea(s) pendiente(s):`,
    );

    // Enviar cada tarea con botones inline (una a la vez)
    for (const task of todayTasks) {
      await this.telegramSender.sendText(
        chatId,
        `📌 *${task.title}*\n_Estado: ${task.status}_`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Hecha',     callback_data: `co:done:${task.taskId}` },
                { text: '⏭ Mañana',   callback_data: `co:defer:${task.taskId}` },
                { text: '❌ Cancelar', callback_data: `co:cancel:${task.taskId}` },
              ],
            ],
          },
        },
      );
    }

    await this.engagementService.transitionState(userId, ENGAGEMENT_STATES.AWAITING_CHECKOUT);

    // Fallback: si en 1 hora el usuario no completó el check-out, generar reporte de todos modos
    const fallbackJobId = `daily-report:${userId}:${sessionDate.toISOString().slice(0, 10)}`;
    await this.queueService.dailyReport.add(
      JOB_NAMES.DAILY_REPORT,
      { userId },
      { delay: ONE_HOUR_MS, jobId: fallbackJobId, removeOnComplete: true, removeOnFail: 3 },
    );

    this.logger.log(`Check-out disparado para ${userId}: ${todayTasks.length} tarea(s)`);
  }

  async completeSession(
    userId: string,
    sessionDate: Date,
    summary: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.dailySession.update({
      where: { userId_sessionDate_sessionType: { userId, sessionDate, sessionType: 'CHECKOUT' } },
      data: { status: 'COMPLETED', completedAt: new Date(), summary: summary as Prisma.InputJsonValue },
    });
  }
}
