import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { DatabaseModule } from './database/database.module';
import { PrismaService } from './database/prisma.service';
import { RedisModule, REDIS_CLIENT } from './redis/redis.module';
import { ProactivityModule } from './modules/proactivity/proactivity.module';
import { CheckinProcessor } from './modules/proactivity/checkin.processor';
import { CheckoutProcessor } from './modules/proactivity/checkout.processor';
import { InactivityScanProcessor } from './modules/proactivity/inactivity-scan.processor';
import { QueueService } from './modules/proactivity/queue.service';
import { QUEUES } from './modules/proactivity/proactivity.constants';
import { Inject } from '@nestjs/common';

/** Crea y gestiona los BullMQ Workers para cada cola del motor de proactividad. */
@Injectable()
class WorkerManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerManagerService.name);
  private readonly workers: Worker[] = [];

  constructor(
    private readonly checkinProcessor:         CheckinProcessor,
    private readonly checkoutProcessor:        CheckoutProcessor,
    private readonly inactivityScanProcessor:  InactivityScanProcessor,
    private readonly queueService:             QueueService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  onModuleInit(): void {
    const conn = { connection: this.redis };

    this.workers.push(
      new Worker(
        QUEUES.CHECKIN,
        (job) => this.checkinProcessor.process(job),
        { ...conn, concurrency: 5 },
      ),
      new Worker(
        QUEUES.CHECKOUT,
        (job) => this.checkoutProcessor.process(job),
        { ...conn, concurrency: 5 },
      ),
      new Worker(
        QUEUES.INACTIVITY_SCAN,
        (job) => this.inactivityScanProcessor.process(job),
        { ...conn, concurrency: 1 },
      ),
    );

    this.workers.forEach((w) => {
      w.on('completed', (job) =>
        this.logger.log(`Job ${job.name}#${job.id} completado`),
      );
      w.on('failed', (job, err) =>
        this.logger.error(`Job ${job?.name}#${job?.id} fallido: ${(err as Error).message}`),
      );
    });

    this.logger.log('BullMQ workers iniciados (checkin, checkout, inactivity-scan)');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    this.logger.log('BullMQ workers cerrados');
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RedisModule,
    ProactivityModule,
  ],
  providers: [WorkerManagerService],
})
class WorkerModule {}

const logger = new Logger('Worker');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });

  const config  = app.get(ConfigService);
  const prisma  = app.get(PrismaService);

  // Verificar conectividad
  await prisma.$queryRaw`SELECT 1`;
  logger.log('PostgreSQL conectado');

  // Heartbeat para GET /health
  const redis       = app.get<IORedis>(REDIS_CLIENT);
  const heartbeatKey = 'heartbeat:worker';
  const heartbeatTtl = 20 * 60;

  async function heartbeat() {
    await redis.set(heartbeatKey, Date.now().toString(), 'EX', heartbeatTtl);
  }
  await heartbeat();
  logger.log('Worker iniciado con motor de proactividad');

  const interval = setInterval(() => {
    heartbeat().catch((err: unknown) => logger.error('Heartbeat fallido', err));
  }, 5 * 60 * 1000);

  async function shutdown() {
    clearInterval(interval);
    await redis.quit();
    await app.close();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

bootstrap().catch((err: unknown) => {
  console.error('[worker] Error fatal en arranque', err);
  process.exit(1);
});
