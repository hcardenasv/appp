import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import IORedis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  private readonly redis: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.redis = new IORedis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  @Get()
  async check() {
    const [dbOk, workerAlive] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.get('heartbeat:worker').then((v) => v !== null).catch(() => false),
    ]);

    return {
      status: 'ok',
      db: dbOk ? 'alive' : 'dead',
      worker: workerAlive ? 'alive' : 'dead',
    };
  }
}
