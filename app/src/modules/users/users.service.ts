import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { User as TelegramUser } from 'grammy/types';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { userId } });
  }

  async findByTelegramChatId(chatId: number): Promise<User | null> {
    const channel = await this.prisma.channel.findFirst({
      where: {
        channelType: 'TELEGRAM',
        address: { path: ['chat_id'], equals: chatId },
      },
      include: { user: true },
    });
    return channel?.user ?? null;
  }

  async findOrCreateFromTelegram(
    from: TelegramUser,
  ): Promise<{ user: User; isNew: boolean }> {
    const existing = await this.findByTelegramChatId(from.id);
    if (existing) {
      return { user: existing, isNew: false };
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          // Email sintético: reemplazable más tarde con /configurar email@...
          email: `telegram_${from.id}@appp.local`,
          displayName:
            from.first_name +
            (from.last_name ? ` ${from.last_name}` : ''),
        },
      });
      await tx.channel.create({
        data: {
          userId: created.userId,
          channelType: 'TELEGRAM',
          address: {
            chat_id: from.id,
            username: from.username ?? null,
          },
          isVerified: true,
          priority: 1,
        },
      });
      return created;
    });

    return { user, isNew: true };
  }
}
