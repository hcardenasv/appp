import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ConversationModule } from '../conversation/conversation.module';
import { TasksModule } from '../tasks/tasks.module';
import { ProactivityModule } from '../proactivity/proactivity.module';
import { ReportsModule } from '../reports/reports.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PwaModule } from '../pwa/pwa.module';
import { BotService } from './bot.service';

@Module({
  imports: [UsersModule, ConversationModule, TasksModule, ProactivityModule, ReportsModule, NotificationsModule, PwaModule],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
