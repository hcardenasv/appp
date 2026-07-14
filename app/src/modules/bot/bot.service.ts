import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { UsersService } from '../users/users.service';
import { ConversationService } from '../conversation/conversation.service';
import { TasksService } from '../tasks/tasks.service';
import { EngagementService } from '../proactivity/engagement.service';
import type { AppContext } from './bot.context';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private bot: Bot<AppContext> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly conversationService: ConversationService,
    private readonly tasksService: TasksService,
    private readonly engagementService: EngagementService,
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
    // Middleware: resuelve appUser + registra interacción para engagement
    bot.use(async (ctx, next) => {
      if (ctx.from) {
        const user = await this.usersService.findByTelegramChatId(ctx.from.id);
        ctx.appUser = user ?? undefined;
        if (user) {
          await this.engagementService
            .recordInteraction(user.userId, 'TELEGRAM')
            .catch(() => undefined);
        }
      }
      await next();
    });

    bot.command('start', async (ctx) => {
      if (!ctx.from) return;
      const { user, isNew } = await this.usersService.findOrCreateFromTelegram(ctx.from);
      const name = user.displayName.split(' ')[0];

      if (isNew) {
        await ctx.reply(
          `¡Hola, ${name}! 👋 Soy tu asistente personal APPP.\n\n` +
            `Estoy aquí para ayudarte a gestionar tus tareas y mantenerte en ` +
            `foco durante el día. Recibirás un check-in matutino cuando empiece ` +
            `tu jornada laboral.\n\n` +
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
          `y el check-out vespertino. También recibirás recordatorios de tus tareas.\n\n` +
          `Puedes escribirme en lenguaje natural: "tengo reunión con el cliente ` +
          `el viernes a las 10", "ya terminé el informe", "¿qué tengo pendiente?"`,
        { parse_mode: 'Markdown' },
      );
    });

    // Botones inline del check-out: co:{done|defer|cancel}:{taskId}
    bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      if (!data?.startsWith('co:')) {
        await ctx.answerCallbackQuery();
        return;
      }

      if (!ctx.appUser) {
        await ctx.answerCallbackQuery({ text: 'No estás registrado. Usa /start.' });
        return;
      }

      const parts  = data.split(':');
      const action = parts[1];
      const taskId = parts[2];

      await this.handleCheckoutCallback(ctx, ctx.appUser.userId, action, taskId);
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

  private async handleCheckoutCallback(
    ctx: AppContext,
    userId: string,
    action: string,
    taskId: string,
  ): Promise<void> {
    let text: string;
    try {
      switch (action) {
        case 'done':
          await this.tasksService.updateStatus(taskId, userId, { toStatus: 'DONE' });
          text = '✅ ¡Marcada como hecha!';
          break;
        case 'defer': {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(9, 0, 0, 0);
          await this.tasksService.updateStatus(taskId, userId, {
            toStatus: 'DEFERRED',
            newScheduledFor: tomorrow.toISOString(),
          });
          text = '⏭ Pospuesta para mañana.';
          break;
        }
        case 'cancel':
          await this.tasksService.updateStatus(taskId, userId, { toStatus: 'CANCELLED' });
          text = '❌ Cancelada.';
          break;
        default:
          text = 'Acción no reconocida.';
      }
    } catch (err) {
      text = 'No se pudo actualizar. Puede que la tarea ya fue modificada.';
      this.logger.warn(`Error en callback checkout ${action}:${taskId}`, err);
    }

    await ctx.answerCallbackQuery({ text });

    // Editar el mensaje para quitar los botones y mostrar el resultado
    if (ctx.callbackQuery.message) {
      const original = ctx.callbackQuery.message.text ?? '';
      await ctx
        .editMessageText(`${original}\n${text}`, { reply_markup: { inline_keyboard: [] } })
        .catch(() => undefined);
    }
  }

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
