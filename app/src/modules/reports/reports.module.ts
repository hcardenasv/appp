import { Module } from '@nestjs/common';
import { ProactivityModule } from '../proactivity/proactivity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsService } from './reports.service';
import { DailyReportProcessor } from './daily-report.processor';
import { PeriodReportProcessor } from './period-report.processor';

@Module({
  imports: [ProactivityModule, NotificationsModule],
  providers: [ReportsService, DailyReportProcessor, PeriodReportProcessor],
  exports: [ReportsService, DailyReportProcessor, PeriodReportProcessor],
})
export class ReportsModule {}
