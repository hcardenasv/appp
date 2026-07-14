import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ConversationModule } from '../conversation/conversation.module';
import { BotService } from './bot.service';

@Module({
  imports: [UsersModule, ConversationModule],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
