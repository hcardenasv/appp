import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { UsersService } from '../users/users.service';
import { ConversationService } from '../conversation/conversation.service';
import { TasksService } from '../tasks/tasks.service';
import { EngagementService } from '../proactivity/engagement.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationService } from '../notifications/notification.service';
import { PwaService } from '../pwa/pwa.service';
import type { AppContext } from './bot.context';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    private readonly reportsService: ReportsService,
    private readonly notificationService: NotificationService,
    private readonly pwaService: PwaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN', '');
    if (!token || token === 'changeme') {
      this.logger.warn('TELEGRAM_BOT_TOKEN no configurado — bot inactivo');
      return;
    }

    this.bot = new Bot<AppContext>(token);
    this.registerHandlers(this.bot);
    void this.bot.start().catch((err) => this.logger.error('Bot polling error', err));

    // Registrar comandos visibles en el menú "/" de Telegram
    await this.bot.api.setMyCommands([
      { command: 'start',  description: 'Registrarse o dar la bienvenida de vuelta' },
      { command: 'ayuda',  description: 'Ver todos los comandos disponibles' },
      { command: 'tareas', description: 'Ver y gestionar tus tareas en el navegador' },
      { command: 'email',  description: 'Configurar email: /email tu@correo.com' },
      { command: 'pwa',    description: 'Instalar la app web y activar notificaciones push' },
    ]).catch(err => this.logger.warn('No se pudo registrar comandos en Telegram', err));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
    }
  }

  private registerHandlers(bot: Bot<AppContext>): void {
    // Middleware: resuelve appUser + registra interacción + marca notificaciones ack'das
    bot.use(async (ctx, next) => {
      if (ctx.from) {
        const user = await this.usersService.findByTelegramChatId(ctx.from.id);
        ctx.appUser = user ?? undefined;
        if (user) {
          await this.engagementService
            .recordInteraction(user.userId, 'TELEGRAM')
            .catch(() => undefined);
          // Cualquier actividad del usuario cancela la escalación pendiente
          await this.notificationService.markAcked(user.userId).catch(() => undefined);
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
          `*Comandos:*\n` +
          `/start — Registrarse o dar la bienvenida\n` +
          `/tareas — Ver tus tareas en el navegador \\(enlace 24h\\)\n` +
          `/email — Configurar email \\(ej: /email nombre@dominio\\.com\\)\n` +
          `/pwa — Instalar app web y activar notificaciones push\n` +
          `/ayuda — Mostrar este mensaje\n\n` +
          `*Lenguaje natural* — escríbeme directamente:\n` +
          `"tengo reunión con el cliente el viernes a las 10"\n` +
          `"ya terminé el informe"\n` +
          `"¿qué tengo pendiente?"\n` +
          `"marca la tarea X como hecha"\n\n` +
          `El sistema te enviará el check\\-in matutino y el check\\-out vespertino automáticamente según tu horario laboral\\.`,
        { parse_mode: 'MarkdownV2' },
      );
    });

    bot.command('pwa', async (ctx) => {
      if (!ctx.appUser) {
        await ctx.reply('No estás registrado. Usa /start primero.');
        return;
      }
      const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
      const token  = await this.pwaService.generateToken(ctx.appUser.userId);
      const url    = `${appUrl}/?token=${token}`;
      await ctx.reply(
        `📲 *Instala APPP como app de escritorio*\n\n` +
          `Abre este enlace en Chrome o Edge para instalar APPP y activar notificaciones push:\n\n` +
          `${url}\n\n` +
          `⏱ El enlace expira en *5 minutos*. Si caduca, usa /pwa de nuevo.`,
        { parse_mode: 'Markdown' },
      );
    });

    bot.command('tareas', async (ctx) => {
      if (!ctx.appUser) {
        await ctx.reply('No estás registrado. Usa /start primero.');
        return;
      }
      const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
      const token  = await this.pwaService.generateWebSessionToken(ctx.appUser.userId);
      const url    = `${appUrl}/tasks.html?token=${token}`;
      await ctx.reply(
        `📋 *Ver tus tareas*\n\nAbre este enlace para ver y filtrar tus tareas:\n\n${url}\n\n_El enlace es válido por 24 horas._`,
        { parse_mode: 'Markdown' },
      );
    });

    bot.command('email', async (ctx) => {
      if (!ctx.appUser) {
        await ctx.reply('No estás registrado. Usa /start primero.');
        return;
      }
      const arg = ctx.message?.text?.split(' ').slice(1).join('').trim() ?? '';
      if (!arg || !EMAIL_RE.test(arg)) {
        await ctx.reply(
          '📧 Uso: `/email tu@correo.com`\n\nTu email se usará para enviarte notificaciones importantes cuando no estés disponible en Telegram.',
          { parse_mode: 'Markdown' },
        );
        return;
      }
      await this.usersService.updateEmail(ctx.appUser.userId, arg);
      await ctx.reply(`✅ Email configurado: *${arg}*\n\nRecibirás notificaciones escaladas aquí si no respondes en Telegram.`, { parse_mode: 'Markdown' });
    });

    // Botones inline del check-out: co:{done|defer|cancel}:{taskId}
    bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery!.data;
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
    if (ctx.callbackQuery?.message) {
      const original = ctx.callbackQuery.message.text ?? '';
      await ctx
        .editMessageText(`${original}\n${text}`, { reply_markup: { inline_keyboard: [] } })
        .catch(() => undefined);
    }

    // Si todas las tareas del día fueron resueltas, cerrar sesión y enviar reporte
    await this.reportsService.tryCloseCheckout(userId).catch((err) =>
      this.logger.error('Error al intentar cerrar checkout', err),
    );
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
