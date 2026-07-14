import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Api } from 'grammy';
import type { PrismaService } from '../../database/prisma.service';

@Injectable()
export class TelegramSenderService {
  private readonly logger = new Logger(TelegramSenderService.name);
  private readonly api: Api;

  constructor(private readonly config: ConfigService) {
    const token = config.get<string>('TELEGRAM_BOT_TOKEN', 'placeholder');
    this.api = new Api(token);
  }

  async getChatId(prisma: PrismaService, userId: string): Promise<number | null> {
    const channel = await prisma.channel.findFirst({
      where: { userId, channelType: 'TELEGRAM' },
    });
    if (!channel) return null;
    const addr = channel.address as Record<string, unknown>;
    const chatId = addr['chat_id'];
    return typeof chatId === 'number' ? chatId : null;
  }

  async sendText(chatId: number, text: string, extra?: object): Promise<void> {
    try {
      await this.api.sendMessage(chatId, text, extra as Parameters<Api['sendMessage']>[2]);
    } catch (err) {
      this.logger.error(`Error enviando mensaje Telegram a ${chatId}`, err);
    }
  }
}
