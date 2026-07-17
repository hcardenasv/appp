import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { localDateAsUtcMidnight, workdayToCron, afterWorkdayCron } from '../../utils/timezone';
import { QueueService } from './queue.service';
import {
  INACTIVITY_SCAN_CRON,
  JOB_NAMES,
} from './proactivity.constants';

type PeriodType = 'WEEKLY' | 'MONTHLY';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile();
  }

  /** Registra o actualiza jobs para todos los usuarios de la BD. */
  async reconcile(): Promise<void> {
    const users = await this.prisma.user.findMany();
    for (const user of users) {
      await this.registerUser(user);
    }
    await this.ensureInactivityScan();
    this.logger.log(`Jobs reconciliados para ${users.length} usuario(s)`);
  }

  async registerUser(user: User): Promise<void> {
    await Promise.all([
      this.upsertCheckin(user),
      this.upsertCheckout(user),
      this.upsertPeriodReport(user, 'WEEKLY'),
      this.upsertPeriodReport(user, 'MONTHLY'),
    ]);
  }

  async removeUser(userId: string): Promise<void> {
    await Promise.all([
      this.queueService.checkin.removeJobScheduler(`checkin:${userId}`),
      this.queueService.checkout.removeJobScheduler(`checkout:${userId}`),
    ]);
  }

  private async upsertCheckin(user: User): Promise<void> {
    const pattern = workdayToCron(user.workdayStart, user.workDays);
    await this.queueService.checkin.upsertJobScheduler(
      `checkin:${user.userId}`,
      { pattern, tz: user.timezone },
      {
        name: JOB_NAMES.CHECKIN,
        data: { userId: user.userId },
        opts: { removeOnComplete: true, removeOnFail: 3 },
      },
    );
  }

  private async upsertCheckout(user: User): Promise<void> {
    const pattern = workdayToCron(user.workdayEnd, user.workDays);
    await this.queueService.checkout.upsertJobScheduler(
      `checkout:${user.userId}`,
      { pattern, tz: user.timezone },
      {
        name: JOB_NAMES.CHECKOUT,
        data: { userId: user.userId },
        opts: { removeOnComplete: true, removeOnFail: 3 },
      },
    );
  }

  private async ensureInactivityScan(): Promise<void> {
    await this.queueService.inactivityScan.upsertJobScheduler(
      'inactivity-scan-global',
      { pattern: INACTIVITY_SCAN_CRON },
      {
        name: JOB_NAMES.INACTIVITY_SCAN,
        data: {},
        opts: { removeOnComplete: true },
      },
    );
  }

  private async upsertPeriodReport(user: User, periodType: PeriodType): Promise<void> {
    // Semanal: viernes 1h después del fin de jornada
    // Mensual: día 1 de cada mes 1h después del fin de jornada
    const cronSuffix = periodType === 'WEEKLY' ? '* * 5' : '1 * *';
    const pattern = afterWorkdayCron(user.workdayEnd, cronSuffix);
    await this.queueService.periodReport.upsertJobScheduler(
      `${periodType.toLowerCase()}-report:${user.userId}`,
      { pattern, tz: user.timezone },
      {
        name: JOB_NAMES.PERIOD_REPORT,
        data: { userId: user.userId, periodType },
        opts: { removeOnComplete: true, removeOnFail: 3 },
      },
    );
  }

  // Expuesto para que UsersService lo llame al crear el primer usuario
  localDateAsUtcMidnight = localDateAsUtcMidnight;
}
