import { Module } from '@nestjs/common';
import { ProactivityModule } from '../proactivity/proactivity.module';
import { EmailService } from './email.service';
import { NotificationService } from './notification.service';
import { ReminderProcessor } from './reminder.processor';
import { ReminderSchedulerService } from './reminder-scheduler.service';

@Module({
  imports: [
    ProactivityModule, // QueueService (cola reminders) + TelegramSenderService
  ],
  providers: [
    EmailService,
    NotificationService,
    ReminderSchedulerService,
    ReminderProcessor,
  ],
  exports: [
    EmailService,
    NotificationService,
    ReminderSchedulerService,
    ReminderProcessor,
  ],
})
export class NotificationsModule {}
