import { Module } from '@nestjs/common';
import { ProactivityModule } from '../proactivity/proactivity.module';
import { PwaModule } from '../pwa/pwa.module';
import { EmailService } from './email.service';
import { NotificationService } from './notification.service';
import { ReminderProcessor } from './reminder.processor';
import { ReminderSchedulerService } from './reminder-scheduler.service';
import { EscalationProcessor } from './escalation.processor';

@Module({
  imports: [
    ProactivityModule, // QueueService (colas reminders + escalation) + TelegramSenderService
    PwaModule,         // WebPushService para canal WEB_PUSH
  ],
  providers: [
    EmailService,
    NotificationService,
    ReminderSchedulerService,
    ReminderProcessor,
    EscalationProcessor,
  ],
  exports: [
    EmailService,
    NotificationService,
    ReminderSchedulerService,
    ReminderProcessor,
    EscalationProcessor,
  ],
})
export class NotificationsModule {}
