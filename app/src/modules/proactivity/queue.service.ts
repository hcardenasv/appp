import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { QUEUES } from './proactivity.constants';

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly checkin:         Queue;
  readonly checkout:        Queue;
  readonly inactivityScan:  Queue;

  constructor(@Inject(REDIS_CLIENT) redis: IORedis) {
    const conn = { connection: redis };
    this.checkin        = new Queue(QUEUES.CHECKIN,         conn);
    this.checkout       = new Queue(QUEUES.CHECKOUT,        conn);
    this.inactivityScan = new Queue(QUEUES.INACTIVITY_SCAN, conn);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.checkin.close(),
      this.checkout.close(),
      this.inactivityScan.close(),
    ]);
  }
}
