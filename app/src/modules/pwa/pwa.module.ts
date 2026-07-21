import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { RedisModule } from '../../redis/redis.module';
import { WebPushService } from './web-push.service';
import { PwaService } from './pwa.service';
import { PwaController } from './pwa.controller';

@Module({
  imports:     [DatabaseModule, RedisModule],
  controllers: [PwaController],
  providers:   [WebPushService, PwaService],
  exports:     [WebPushService, PwaService],
})
export class PwaModule {}
