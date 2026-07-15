import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { QUEUES } from './proactivity.constants';

function bullmqConn(redisUrl: string) {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: parseInt(u.port || '6379', 10),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
  };
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly checkin:         Queue;
  readonly checkout:        Queue;
  readonly inactivityScan:  Queue;
  readonly reminders:       Queue;
  readonly dailyReport:     Queue;

  constructor(config: ConfigService) {
    const conn = { connection: bullmqConn(config.get<string>('REDIS_URL', 'redis://localhost:6379')) };
    this.checkin        = new Queue(QUEUES.CHECKIN,         conn);
    this.checkout       = new Queue(QUEUES.CHECKOUT,        conn);
    this.inactivityScan = new Queue(QUEUES.INACTIVITY_SCAN, conn);
    this.reminders      = new Queue(QUEUES.REMINDERS,       conn);
    this.dailyReport    = new Queue(QUEUES.DAILY_REPORT,    conn);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.checkin.close(),
      this.checkout.close(),
      this.inactivityScan.close(),
      this.reminders.close(),
      this.dailyReport.close(),
    ]);
  }
}
