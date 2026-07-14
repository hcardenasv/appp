import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { HealthController } from './health.controller';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { ProactivityModule } from './modules/proactivity/proactivity.module';
import { BotModule } from './modules/bot/bot.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RedisModule,
    UsersModule,
    TasksModule,
    ConversationModule,
    ProactivityModule,
    BotModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
