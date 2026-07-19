import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from './email.service';
import { buildEscalationEmail } from './email-templates';
import { ESCALATION_DELAY_MS } from './notifications.constants';

export interface EscalationJobData {
  notificationId: string;
  userId: string;
  title: string;
  body: string;
}

@Injectable()
export class EscalationProcessor {
  private readonly logger = new Logger(EscalationProcessor.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly emailService:  EmailService,
  ) {}

  async process(job: Job<EscalationJobData>): Promise<void> {
    const { notificationId, userId, title, body } = job.data;

    // Skip if user has been active recently (lastInteractionAt within the escalation window)
    const engagement = await this.prisma.engagementState.findUnique({
      where: { userId },
      select: { lastInteractionAt: true },
    });
    const windowAgo = new Date(Date.now() - ESCALATION_DELAY_MS);
    if (engagement?.lastInteractionAt && engagement.lastInteractionAt > windowAgo) {
      this.logger.debug(`Usuario ${userId} activo recientemente — escalación omitida`);
      return;
    }

    // Skip if notification was already acked
    const notification = await this.prisma.notification.findFirst({
      where: { notificationId },
      select: { ackedAt: true },
    });
    if (!notification || notification.ackedAt) {
      this.logger.debug(`Notificación ${notificationId} ya fue ack'da — escalación omitida`);
      return;
    }

    // Get user email
    const user = await this.prisma.user.findUnique({
      where: { userId },
      select: { email: true },
    });
    if (!user || !this.emailService.isRealEmail(user.email)) {
      this.logger.debug(`Usuario ${userId} sin email real — escalación omitida`);
      return;
    }

    // Send escalation email
    try {
      const { subject, html, text } = buildEscalationEmail(title, body);
      await this.emailService.sendHtml(user.email, subject, html, text);

      await this.prisma.notificationDelivery.create({
        data: { notificationId, channelType: 'EMAIL', status: 'SENT', sentAt: new Date(), statusAt: new Date() },
      });
      this.logger.log(`Escalación email enviada para notif ${notificationId} → ${user.email}`);
    } catch (err) {
      this.logger.error(`Error en escalación email para ${notificationId}`, err);
      await this.prisma.notificationDelivery.create({
        data: { notificationId, channelType: 'EMAIL', status: 'FAILED', statusAt: new Date(), providerRef: String(err) },
      });
    }
  }
}
