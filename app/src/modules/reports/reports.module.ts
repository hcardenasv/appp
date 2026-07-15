import { Module } from '@nestjs/common';
import { ProactivityModule } from '../proactivity/proactivity.module';
import { ReportsService } from './reports.service';
import { DailyReportProcessor } from './daily-report.processor';

@Module({
  imports: [ProactivityModule],
  providers: [ReportsService, DailyReportProcessor],
  exports: [ReportsService, DailyReportProcessor],
})
export class ReportsModule {}
