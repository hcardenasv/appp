import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { SchedulerService } from './scheduler.service';
import { EngagementService } from './engagement.service';
import { TelegramSenderService } from './telegram-sender.service';
import { CheckinProcessor } from './checkin.processor';
import { CheckoutProcessor } from './checkout.processor';
import { InactivityScanProcessor } from './inactivity-scan.processor';

@Module({
  providers: [
    QueueService,
    SchedulerService,
    EngagementService,
    TelegramSenderService,
    CheckinProcessor,
    CheckoutProcessor,
    InactivityScanProcessor,
  ],
  exports: [
    QueueService,
    SchedulerService,
    EngagementService,
    TelegramSenderService,
    CheckinProcessor,
    CheckoutProcessor,
    InactivityScanProcessor,
  ],
})
export class ProactivityModule {}
