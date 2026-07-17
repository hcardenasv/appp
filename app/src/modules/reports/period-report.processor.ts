import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ReportsService } from './reports.service';

@Injectable()
export class PeriodReportProcessor {
  private readonly logger = new Logger(PeriodReportProcessor.name);

  constructor(private readonly reportsService: ReportsService) {}

  async process(job: Job<{ userId: string; periodType: 'WEEKLY' | 'MONTHLY' }>): Promise<void> {
    const { userId, periodType } = job.data;
    this.logger.log(`Generando reporte ${periodType} para ${userId}`);
    if (periodType === 'WEEKLY') {
      await this.reportsService.generateWeeklyReport(userId);
    } else {
      await this.reportsService.generateMonthlyReport(userId);
    }
  }
}
