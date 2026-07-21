import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../../database/prisma.service';

export interface PushPayload {
  title: string;
  body:  string;
  url?:  string;
}

@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private readonly configured: boolean;

  constructor(
    private readonly config:  ConfigService,
    private readonly prisma:  PrismaService,
  ) {
    const pub   = config.get<string>('VAPID_PUBLIC_KEY');
    const priv  = config.get<string>('VAPID_PRIVATE_KEY');
    const email = config.get<string>('VAPID_EMAIL') ?? 'mailto:admin@appp.local';

    if (pub && priv) {
      webpush.setVapidDetails(email, pub, priv);
      this.configured = true;
    } else {
      this.configured = false;
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getPublicKey(): string | undefined {
    return this.config.get<string>('VAPID_PUBLIC_KEY');
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) return;

    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return;

    const expired: string[] = [];

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } },
          JSON.stringify(payload),
          { TTL: 86400 },
        );
        await this.prisma.pushSubscription.update({
          where: { subId: sub.subId },
          data:  { lastUsedAt: new Date() },
        });
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          expired.push(sub.subId);
        } else {
          this.logger.error(`Error enviando Web Push a sub ${sub.subId}`, err);
        }
      }
    }

    if (expired.length) {
      await this.prisma.pushSubscription.deleteMany({ where: { subId: { in: expired } } });
      this.logger.debug(`Eliminadas ${expired.length} suscripciones expiradas del usuario ${userId}`);
    }
  }
}
