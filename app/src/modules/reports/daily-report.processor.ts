import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { localDateAsUtcMidnight } from '../../utils/timezone';
import { ReportsService } from './reports.service';

@Injectable()
export class DailyReportProcessor {
  private readonly logger = new Logger(DailyReportProcessor.name);

  constructor(
    private readonly prisma:         PrismaService,
    private readonly reportsService: ReportsService,
  ) {}

  async process(job: Job<{ userId: string }>): Promise<void> {
    const { userId } = job.data;

    const user = await this.prisma.user.findUnique({ where: { userId } });
    if (!user) return;

    const sessionDate = localDateAsUtcMidnight(user.timezone);

    // No reenviar si el reporte ya fue generado (bot path cerró antes que el fallback)
    const existing = await this.prisma.report.findUnique({
      where: { userId_periodType_periodStart: { userId, periodType: 'DAILY', periodStart: sessionDate } },
    });
    if (existing) {
      this.logger.debug(`Reporte diario ya existe para ${userId}, saltando fallback`);
      return;
    }

    const session = await this.prisma.dailySession.findUnique({
      where: { userId_sessionDate_sessionType: { userId, sessionDate, sessionType: 'CHECKOUT' } },
    });

    const missed = !session || !['TRIGGERED', 'IN_PROGRESS', 'COMPLETED'].includes(session.status);
    await this.reportsService.generateAndSend(userId, user, sessionDate, missed);
  }
}
