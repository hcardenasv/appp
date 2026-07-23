import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { Redis } from 'ioredis';
import type { User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { TasksService } from '../tasks/tasks.service';
import { CONVERSATION_TOOLS } from './conversation.tools';
import type { CreateTaskDto } from '../tasks/dto/create-task.dto';
import type { UpdateTaskStatusDto } from '../tasks/dto/update-task-status.dto';

const SESSION_KEY = (userId: string) => `conv:session:${userId}`;
const SESSION_TTL_SEC = 1800; // 30 minutos
const SESSION_MAX_MESSAGES = 20;
const TOOL_LOOP_MAX = 3;

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tasksService: TasksService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY', '');
    this.anthropic = new Anthropic({ apiKey });
    this.model = config.get<string>(
      'ANTHROPIC_MODEL_NLU',
      'claude-haiku-4-5-20251001',
    );
  }

  async processMessage(
    user: User,
    text: string,
    channelType: string,
  ): Promise<string> {
    // Log inbound interaction
    await this.logInteraction(user.userId, channelType, 'INBOUND', text);

    let response: string;
    let intent: string | null = null;

    try {
      const session = await this.loadSession(user.userId);
      const systemPrompt = await this.buildSystemPrompt(user);

      session.push({ role: 'user', content: text });

      const result = await this.runToolLoop(session, systemPrompt, user.userId);
      response = result.text;
      intent = result.intent;

      session.push({ role: 'assistant', content: response });
      await this.saveSession(user.userId, session);
    } catch (err) {
      this.logger.error('Error en pipeline NLU', err);
      response =
        'Lo siento, tuve un problema procesando tu mensaje. Intenta nuevamente en un momento.';
    }

    // Log outbound interaction
    await this.logInteraction(user.userId, channelType, 'OUTBOUND', response, intent);

    return response;
  }

  private async runToolLoop(
    messages: Anthropic.MessageParam[],
    systemPrompt: string,
    userId: string,
  ): Promise<{ text: string; intent: string | null }> {
    const current = [...messages];
    let intent: string | null = null;

    for (let i = 0; i < TOOL_LOOP_MAX; i++) {
      const apiResponse = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: current,
        tools: CONVERSATION_TOOLS,
      });

      if (apiResponse.stop_reason === 'end_turn') {
        const text = apiResponse.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        return { text: text || 'Entendido.', intent };
      }

      if (apiResponse.stop_reason === 'tool_use') {
        current.push({ role: 'assistant', content: apiResponse.content });

        const toolUseBlocks = apiResponse.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
        );

        const toolResults: Anthropic.MessageParam = {
          role: 'user',
          content: await Promise.all(
            toolUseBlocks.map(async (block) => {
              if (!intent) intent = block.name;
              const result = await this.executeTool(
                block.name,
                block.input as Record<string, unknown>,
                userId,
              );
              return {
                type: 'tool_result' as const,
                tool_use_id: block.id,
                content: result,
              };
            }),
          ),
        };

        current.push(toolResults);
        continue;
      }

      // stop_reason inesperado
      break;
    }

    return { text: 'Entendido.', intent };
  }

  private async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    userId: string,
  ): Promise<string> {
    try {
      switch (toolName) {
        case 'create_task': {
          const task = await this.tasksService.create(
            userId,
            input as unknown as CreateTaskDto,
          );
          return JSON.stringify({
            ok: true,
            taskId: task.taskId,
            title: task.title,
            status: task.status,
          });
        }

        case 'update_task_status': {
          const updated = await this.tasksService.updateStatus(
            input.taskId as string,
            userId,
            input as unknown as UpdateTaskStatusDto,
          );
          return JSON.stringify({ ok: true, taskId: updated.taskId, status: updated.status });
        }

        case 'reschedule': {
          const updated = await this.tasksService.update(
            input.taskId as string,
            userId,
            {
              ...(input.newScheduledFor ? { scheduledFor: input.newScheduledFor as string } : {}),
              ...(input.newDueAt ? { dueAt: input.newDueAt as string } : {}),
            },
          );
          return JSON.stringify({
            ok: true,
            taskId: updated.taskId,
            scheduledFor: updated.scheduledFor,
            dueAt: updated.dueAt,
          });
        }

        case 'get_daily_summary': {
          const tasks = await this.tasksService.findByUser(userId, true);
          if (!tasks.length) {
            return JSON.stringify({ count: 0, message: 'No tienes tareas activas.' });
          }
          const lines = tasks.map(
            (t) =>
              `[${t.status}] P${t.priority} – ${t.title}` +
              (t.dueAt ? ` (vence: ${t.dueAt.toISOString()})` : '') +
              (t.scheduledFor ? ` (prog: ${t.scheduledFor.toISOString()})` : ''),
          );
          return JSON.stringify({ count: tasks.length, tasks: lines });
        }

        case 'log_progress': {
          const updated = await this.tasksService.update(
            input.taskId as string,
            userId,
            { progressPct: input.progressPct as number },
          );
          return JSON.stringify({
            ok: true,
            taskId: updated.taskId,
            progressPct: updated.progressPct,
          });
        }

        default:
          return JSON.stringify({ error: `Herramienta desconocida: ${toolName}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Error ejecutando tool ${toolName}: ${message}`);
      return JSON.stringify({ error: message });
    }
  }

  private async buildSystemPrompt(user: User): Promise<string> {
    const now = new Date().toLocaleString('es-CL', { timeZone: user.timezone });
    const tasks = await this.tasksService.findByUser(user.userId, true);

    const taskLines = tasks.length
      ? tasks
          .map(
            (t) =>
              `  • [${t.taskId}] (${t.status}) P${t.priority} – ${t.title}` +
              (t.dueAt ? ` | vence: ${t.dueAt.toISOString()}` : ''),
          )
          .join('\n')
      : '  (sin tareas activas)';

    return (
      `Eres el asistente personal de productividad APPP.\n` +
      `Tu función es interpretar los mensajes del usuario y ejecutar acciones mediante las herramientas disponibles.\n\n` +
      `Fecha y hora: ${now} (TZ: ${user.timezone})\n` +
      `Usuario: ${user.displayName}\n\n` +
      `Tareas activas (incluye taskId para operaciones):\n${taskLines}\n\n` +
      `Reglas:\n` +
      `- Usa las herramientas para crear/modificar tareas; nunca respondas solo con texto cuando el usuario quiera hacer cambios.\n` +
      `- RECORDATORIOS: cuando el usuario diga "recuérdame X a las HH:MM" usa taskType=REMINDER y dueAt con fecha y hora completa en ISO 8601 (ej: ${new Date().toISOString().slice(0,10)}T20:45:00). NUNCA uses scheduledFor para recordatorios con hora.\n` +
      `- Para posponer una tarea, usa update_task_status con toStatus=DEFERRED y newScheduledFor (fecha obligatoria).\n` +
      `- Responde siempre en español, de forma concisa y directa.\n` +
      `- Si el usuario pregunta qué tiene pendiente, usa get_daily_summary primero.`
    );
  }

  private async loadSession(userId: string): Promise<Anthropic.MessageParam[]> {
    try {
      const raw = await this.redis.get(SESSION_KEY(userId));
      return raw ? (JSON.parse(raw) as Anthropic.MessageParam[]) : [];
    } catch {
      return [];
    }
  }

  private async saveSession(userId: string, messages: Anthropic.MessageParam[]): Promise<void> {
    const trimmed = messages.slice(-SESSION_MAX_MESSAGES);
    await this.redis.set(SESSION_KEY(userId), JSON.stringify(trimmed), 'EX', SESSION_TTL_SEC);
  }

  private async logInteraction(
    userId: string,
    channelType: string,
    direction: 'INBOUND' | 'OUTBOUND',
    content: string,
    intent?: string | null,
  ): Promise<void> {
    try {
      await this.prisma.interactionLog.create({
        data: {
          userId,
          channelType,
          direction,
          modality: 'TEXT',
          content,
          intent: intent ?? null,
        },
      });
    } catch (err) {
      // No debe interrumpir el flujo principal
      this.logger.warn('No se pudo guardar interaction_log', err);
    }
  }
}
