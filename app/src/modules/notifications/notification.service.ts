import { Inject, Injectable, Logger } from '@nestjs/common';
import type IORedis from 'ioredis';
import { PrismaService } from '../../database/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { TelegramSenderService } from '../proactivity/telegram-sender.service';
import { EmailService } from './email.service';
import { MAX_NOTIFICATIONS_PER_HOUR } from './notifications.constants';

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
    private readonly prisma:    PrismaService,
    private readonly telegram:  TelegramSenderService,
    private readonly email:     EmailService,
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
    } else {
      // Fallback a email si no hay canal Telegram configurado
      await this.deliverViaEmail(notification.notificationId, userId, title, body);
    }
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
    if (!user?.email || user.email.endsWith('@appp.local')) return;

    const delivery = await this.prisma.notificationDelivery.create({
      data: { notificationId, channelType: 'EMAIL', status: 'QUEUED' },
    });

    try {
      await this.email.send(user.email, title, body);
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

  // ─── Rate limit ────────────────────────────────────────────────────────────

  private async checkRateLimit(userId: string): Promise<boolean> {
    const hour = Math.floor(Date.now() / 3_600_000);
    const key  = `rate:notif:${userId}:${hour}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 3_600);
    return count <= MAX_NOTIFICATIONS_PER_HOUR;
  }
}
