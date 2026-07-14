import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { EngagementService } from './engagement.service';
import { TelegramSenderService } from './telegram-sender.service';
import { localDateAsUtcMidnight } from '../../utils/timezone';
import {
  ENGAGEMENT_STATES,
  NUDGE_THRESHOLDS_MIN,
} from './proactivity.constants';

const MINS_AGO = (min: number) => new Date(Date.now() - min * 60_000);

@Injectable()
export class InactivityScanProcessor {
  private readonly logger = new Logger(InactivityScanProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engagementService: EngagementService,
    private readonly telegramSender: TelegramSenderService,
  ) {}

  async process(_job: Job): Promise<void> {
    const awaiting = await this.prisma.engagementState.findMany({
      where: {
        currentState: {
          in: [ENGAGEMENT_STATES.AWAITING_CHECKIN, ENGAGEMENT_STATES.AWAITING_CHECKOUT],
        },
      },
      include: { user: true },
    });

    for (const state of awaiting) {
      await this.evaluateUser(state);
    }
  }

  private async evaluateUser(
    state: Awaited<ReturnType<typeof this.prisma.engagementState.findMany>>[0],
  ): Promise<void> {
    const { userId, currentState, stateChangedAt, nudgeLevel } = state;
    const user = state.user;
    const minutesSinceChange = (Date.now() - stateChangedAt.getTime()) / 60_000;

    if (minutesSinceChange >= NUDGE_THRESHOLDS_MIN.DORMANT) {
      await this.markDormant(userId, currentState, user.timezone);
      return;
    }

    if (minutesSinceChange >= NUDGE_THRESHOLDS_MIN.SECOND && nudgeLevel < 2) {
      await this.nudge(userId, currentState, 2, user);
      return;
    }

    if (minutesSinceChange >= NUDGE_THRESHOLDS_MIN.FIRST && nudgeLevel < 1) {
      await this.nudge(userId, currentState, 1, user);
    }
  }

  private async nudge(
    userId: string,
    currentState: string,
    level: number,
    user: { displayName: string },
  ): Promise<void> {
    const newState = level >= 2 ? ENGAGEMENT_STATES.ESCALATING : ENGAGEMENT_STATES.NUDGING;
    await this.engagementService.transitionState(userId, newState, level);

    const chatId = await this.telegramSender.getChatId(this.prisma, userId);
    if (!chatId) return;

    const name = user.displayName.split(' ')[0];
    const isCheckin = currentState === ENGAGEMENT_STATES.AWAITING_CHECKIN;
    const ritualName = isCheckin ? 'check-in matutino' : 'check-out vespertino';

    const msg =
      level === 1
        ? `👋 ${name}, aún no has hecho tu ${ritualName}. ¿Todo bien? Puedo esperarte unos minutos.`
        : `⚠️ ${name}, llevas un rato sin responder. Si no puedes hacer el ${ritualName} ahora, escríbeme cuando puedas y lo haremos juntos.`;

    await this.telegramSender.sendText(chatId, msg);
    this.logger.log(`Nudge nivel ${level} enviado a ${userId} (${currentState})`);
  }

  private async markDormant(
    userId: string,
    currentState: string,
    timezone: string,
  ): Promise<void> {
    await this.engagementService.transitionState(userId, ENGAGEMENT_STATES.DORMANT, 0);

    // Marcar la sesión del día como MISSED
    const sessionType = currentState === ENGAGEMENT_STATES.AWAITING_CHECKIN ? 'CHECKIN' : 'CHECKOUT';
    const sessionDate = localDateAsUtcMidnight(timezone);

    await this.prisma.dailySession
      .updateMany({
        where: {
          userId,
          sessionDate,
          sessionType,
          status: { in: ['TRIGGERED', 'PENDING'] },
        },
        data: { status: 'MISSED' },
      })
      .catch(() => undefined); // tabla puede no tener la sesión todavía

    this.logger.log(`Usuario ${userId} → DORMANT; sesión ${sessionType} marcada MISSED`);
  }
}
