import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { UsersService } from '../users/users.service';
import { ConversationService } from '../conversation/conversation.service';
import type { AppContext } from './bot.context';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private bot: Bot<AppContext> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly conversationService: ConversationService,
  ) {}

  async onModuleInit(): Promise<void> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN', '');
    if (!token || token === 'changeme') {
      this.logger.warn('TELEGRAM_BOT_TOKEN no configurado — bot inactivo');
      return;
    }

    this.bot = new Bot<AppContext>(token);
    this.registerHandlers(this.bot);
    this.startPolling(this.bot);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
    }
  }

  private registerHandlers(bot: Bot<AppContext>): void {
    // Middleware: resuelve appUser en cada update entrante
    bot.use(async (ctx, next) => {
      if (ctx.from) {
        ctx.appUser =
          (await this.usersService.findByTelegramChatId(ctx.from.id)) ??
          undefined;
      }
      await next();
    });

    bot.command('start', async (ctx) => {
      if (!ctx.from) return;
      const { user, isNew } = await this.usersService.findOrCreateFromTelegram(
        ctx.from,
      );
      const name = user.displayName.split(' ')[0];

      if (isNew) {
        await ctx.reply(
          `¡Hola, ${name}! 👋 Soy tu asistente personal APPP.\n\n` +
            `Estoy aquí para ayudarte a gestionar tus tareas y mantenerte en ` +
            `foco durante el día. Pronto te haré el primer check-in matutino.\n\n` +
            `Usa /ayuda para ver qué puedo hacer.`,
        );
      } else {
        await ctx.reply(
          `¡Bienvenido de vuelta, ${name}! 🙌\n` +
            `Estoy activo y listo. Usa /ayuda si necesitas orientación.`,
        );
      }
    });

    bot.command('ayuda', async (ctx) => {
      await ctx.reply(
        `*APPP — Asistente Personal de Productividad*\n\n` +
          `Comandos disponibles:\n` +
          `• /start — Registrarse o dar la bienvenida de vuelta\n` +
          `• /ayuda — Mostrar este mensaje\n\n` +
          `El sistema te contactará proactivamente para el check-in matutino ` +
          `y el check-out vespertino. También recibirás recordatorios de tus ` +
          `tareas importantes.\n\n` +
          `Puedes escribirme en lenguaje natural: "tengo reunión con el cliente ` +
          `el viernes a las 10", "ya terminé el informe", "¿qué tengo pendiente?"`,
        { parse_mode: 'Markdown' },
      );
    });

    // NLU: mensajes de texto libres via Claude API
    bot.on('message:text', async (ctx) => {
      if (!ctx.appUser) {
        await ctx.reply('No te encuentro registrado. Usa /start para comenzar.');
        return;
      }
      try {
        const response = await this.conversationService.processMessage(
          ctx.appUser,
          ctx.message.text,
          'TELEGRAM',
        );
        await ctx.reply(response);
      } catch (err) {
        this.logger.error('Error procesando mensaje de texto', err);
        await ctx.reply('Ocurrió un error. Intenta nuevamente en un momento.');
      }
    });
  }

  private startPolling(bot: Bot<AppContext>): void {
    bot
      .start({
        onStart: (info) =>
          this.logger.log(`Bot @${info.username} en long polling`),
      })
      .catch((err) => this.logger.error('Bot detenido con error', err));
  }

  // Para uso de otros módulos (p. ej. NotificationsModule enviando mensajes)
  getBot(): Bot<AppContext> | null {
    return this.bot;
  }

  async sendMessage(chatId: number, text: string, extra?: object): Promise<void> {
    if (!this.bot) {
      this.logger.warn(`No se puede enviar mensaje a ${chatId}: bot inactivo`);
      return;
    }
    await this.bot.api.sendMessage(chatId, text, extra);
  }
}
