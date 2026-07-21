import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebPushService } from './web-push.service';
import { PwaService, SubscriptionKeys } from './pwa.service';

interface SubscribeBody {
  token:    string;
  endpoint: string;
  keys:     SubscriptionKeys;
}

@Controller('pwa')
export class PwaController {
  constructor(
    private readonly webPushService: WebPushService,
    private readonly pwaService:     PwaService,
  ) {}

  @Get('vapid-key')
  getVapidKey() {
    return { publicKey: this.webPushService.getPublicKey() ?? null };
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  async subscribe(@Body() body: SubscribeBody, @Req() req: Request): Promise<void> {
    const { token, endpoint, keys } = body;
    const userId = await this.pwaService.consumeToken(token);
    if (!userId) throw new UnauthorizedException('Token inválido o expirado');

    const userAgent = req.headers['user-agent'];
    await this.pwaService.saveSubscription(userId, endpoint, keys, userAgent);
  }
}
