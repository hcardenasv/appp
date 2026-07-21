import { Inject, Injectable, Logger } from '@nestjs/common';
import type IORedis from 'ioredis';
import { PrismaService } from '../../database/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { TelegramSenderService } from '../proactivity/telegram-sender.service';
import { QueueService } from '../proactivity/queue.service';
import { JOB_NAMES } from '../proactivity/proactivity.constants';
import { EmailService } from './email.service';
import { buildReminderEmail } from './email-templates';
import { MAX_NOTIFICATIONS_PER_HOUR, ESCALATION_DELAY_MS } from './notifications.constants';
import { WebPushService } from '../pwa/web-push.service';

export interface SendNotificationInput {
  userId:      string;
  sourceType:  string;
  sourceId?:   string;
  title:       string;
  body:        string;
  requiresAck?: boolean;
  dedupKey?:   string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly telegram:      TelegramSenderService,
    private readonly email:         EmailService,
    private readonly queueService:  QueueService,
    private readonly webPush:       WebPushService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  async send(input: SendNotificationInput): Promise<void> {
    const { userId, sourceType, sourceId, title, body, requiresAck = false } = input;
    const dedupKey = input.dedupKey ?? `${sourceType}:${sourceId ?? 'none'}:${userId}`;

    // 1. Dedup: evitar envíos duplicados
    const existing = await this.prisma.notification.findFirst({ where: { dedupKey } });
    if (existing) {
      this.logger.debug(`Notificación duplicada omitida (dedupKey=${dedupKey})`);
      return;
    }

    // 2. Rate limit: fusible anti-spam
    const allowed = await this.checkRateLimit(userId);
    if (!allowed) {
      this.logger.warn(`Rate limit alcanzado para usuario ${userId} — notificación omitida`);
      return;
    }

    // 3. Persistir notificación
    const notification = await this.prisma.notification.create({
      data: { userId, sourceType, sourceId: sourceId ?? null, title, body, requiresAck, dedupKey },
    });

    // 4. Seleccionar canal y enviar
    const chatId = await this.telegram.getChatId(this.prisma, userId);
    if (chatId !== null) {
      await this.deliverViaTelegram(notification.notificationId, chatId, title, body);
      // 5. Si requiresAck, programar escalación por email a los 30 min
      if (requiresAck) {
        await this.scheduleEscalation(notification.notificationId, userId, title, body);
      }
    } else {
      // Fallback a email si no hay canal Telegram configurado
      await this.deliverViaEmail(notification.notificationId, userId, title, body);
    }

    // 6. Web Push: canal paralelo a Telegram (popup de escritorio)
    await this.deliverViaWebPush(notification.notificationId, userId, title, body);
  }

  async markAcked(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, requiresAck: true, ackedAt: null },
      data:  { ackedAt: new Date() },
    });
  }

  // ─── Canales ───────────────────────────────────────────────────────────────

  private async deliverViaTelegram(
    notificationId: string,
    chatId:         number,
    title:          string,
    body:           string,
  ): Promise<void> {
    const delivery = await this.prisma.notificationDelivery.create({
      data: { notificationId, channelType: 'TELEGRAM', status: 'QUEUED' },
    });

    try {
      await this.telegram.sendText(chatId, `*${title}*\n${body}`, { parse_mode: 'Markdown' });
      await this.prisma.notificationDelivery.update({
        where: { deliveryId: delivery.deliveryId },
        data:  { status: 'SENT', sentAt: new Date(), statusAt: new Date() },
      });
    } catch (err) {
      await this.prisma.notificationDelivery.update({
        where: { deliveryId: delivery.deliveryId },
        data:  { status: 'FAILED', statusAt: new Date(), providerRef: String(err) },
      });
      this.logger.error(`Fallo de entrega Telegram para notif ${notificationId}`, err);
    }
  }

  private async deliverViaEmail(
    notificationId: string,
    userId:         string,
    title:          string,
    body:           string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { userId } });
    if (!user || !this.email.isRealEmail(user.email)) return;

    const delivery = await this.prisma.notificationDelivery.create({
      data: { notificationId, channelType: 'EMAIL', status: 'QUEUED' },
    });

    try {
      const { subject, html, text } = buildReminderEmail(title, body);
      await this.email.sendHtml(user.email, subject, html, text);
      await this.prisma.notificationDelivery.update({
        where: { deliveryId: delivery.deliveryId },
        data:  { status: 'SENT', sentAt: new Date(), statusAt: new Date() },
      });
    } catch (err) {
      await this.prisma.notificationDelivery.update({
        where: { deliveryId: delivery.deliveryId },
        data:  { status: 'FAILED', statusAt: new Date(), providerRef: String(err) },
      });
    }
  }

  private async deliverViaWebPush(
    notificationId: string,
    userId:         string,
    title:          string,
    body:           string,
  ): Promise<void> {
    if (!this.webPush.isConfigured()) return;

    const delivery = await this.prisma.notificationDelivery.create({
      data: { notificationId, channelType: 'WEB_PUSH', status: 'QUEUED' },
    });

    try {
      await this.webPush.sendToUser(userId, { title, body, url: '/' });
      await this.prisma.notificationDelivery.update({
        where: { deliveryId: delivery.deliveryId },
        data:  { status: 'SENT', sentAt: new Date(), statusAt: new Date() },
      });
    } catch (err) {
      await this.prisma.notificationDelivery.update({
        where: { deliveryId: delivery.deliveryId },
        data:  { status: 'FAILED', statusAt: new Date(), providerRef: String(err) },
      });
    }
  }

  private async scheduleEscalation(
    notificationId: string,
    userId: string,
    title: string,
    body: string,
  ): Promise<void> {
    await this.queueService.escalation.add(
      JOB_NAMES.ESCALATION,
      { notificationId, userId, title, body },
      { delay: ESCALATION_DELAY_MS, jobId: `escalation:${notificationId}`, removeOnComplete: true, removeOnFail: 3 },
    );
  }

  // ─── Rate limit ────────────────────────────────────────────────────────────

  private async checkRateLimit(userId: string): Promise<boolean> {
    const hour = Math.floor(Date.now() / 3_600_000);
    const key  = `rate:notif:${userId}:${hour}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 3_600);
    return count <= MAX_NOTIFICATIONS_PER_HOUR;
  }
}
