import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type IORedis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { PrismaService } from '../../database/prisma.service';

const TOKEN_TTL_SEC = 300; // 5 minutes

export interface SubscriptionKeys {
  auth:   string;
  p256dh: string;
}

@Injectable()
export class PwaService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    private readonly prisma: PrismaService,
  ) {}

  async generateToken(userId: string): Promise<string> {
    const token = randomUUID();
    await this.redis.set(`pwa_token:${token}`, userId, 'EX', TOKEN_TTL_SEC);
    return token;
  }

  async consumeToken(token: string): Promise<string | null> {
    const key    = `pwa_token:${token}`;
    const userId = await this.redis.get(key);
    if (userId) await this.redis.del(key);
    return userId;
  }

  async saveSubscription(
    userId:    string,
    endpoint:  string,
    keys:      SubscriptionKeys,
    userAgent: string | undefined,
  ): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where:  { userId_endpoint: { userId, endpoint } },
      create: { userId, endpoint, auth: keys.auth, p256dh: keys.p256dh, userAgent },
      update: { auth: keys.auth, p256dh: keys.p256dh, userAgent },
    });
  }
}
