import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { BotService } from './bot.service';

@Module({
  imports: [UsersModule],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
