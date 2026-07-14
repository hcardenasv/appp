import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { ConversationService } from './conversation.service';

@Module({
  imports: [TasksModule],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
