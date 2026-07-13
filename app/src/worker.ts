import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { PrismaService } from './database/prisma.service';
import IORedis from 'ioredis';

// WorkerModule: standalone NestJS context for BullMQ processing.
// Processors for checkin, checkout, inactivity_scan, notifications
// will be registered here in Hitos 4-6.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
  ],
})
class WorkerModule {}

const logger = new Logger('Worker');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });

  const config = app.get(ConfigService);
  const redisUrl = config.getOrThrow<string>('REDIS_URL');

  // Verify Redis connectivity
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  await redis.ping();
  logger.log('Redis connected');

  // Verify PostgreSQL connectivity
  const prisma = app.get(PrismaService);
  await prisma.$queryRaw`SELECT 1`;
  logger.log('PostgreSQL connected');

  // Heartbeat key read by GET /health
  const heartbeatKey = 'heartbeat:worker';
  const heartbeatTtl = 20 * 60; // 20 minutes in seconds

  async function heartbeat() {
    await redis.set(heartbeatKey, Date.now().toString(), 'EX', heartbeatTtl);
  }

  // Initial heartbeat
  await heartbeat();
  logger.log('Worker started — awaiting job processors (Hitos 4-6)');

  // Refresh heartbeat every 5 minutes
  const interval = setInterval(() => {
    heartbeat().catch((err: unknown) => logger.error('Heartbeat failed', err));
  }, 5 * 60 * 1000);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    clearInterval(interval);
    await redis.quit();
    await app.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    clearInterval(interval);
    await redis.quit();
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((err: unknown) => {
  console.error('[worker] Fatal startup error', err);
  process.exit(1);
});
