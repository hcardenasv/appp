import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PwaModule } from '../pwa/pwa.module';
import { TasksController } from './tasks.controller';
import { TasksWebController } from './tasks-web.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [NotificationsModule, PwaModule],
  controllers: [TasksController, TasksWebController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
