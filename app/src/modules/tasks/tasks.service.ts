import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Task, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ReminderSchedulerService } from '../notifications/reminder-scheduler.service';
import {
  assertValidTransition,
  InvalidTransitionError,
  TaskStatus,
} from './task-status.fsm';
import { REMINDER_TEMPLATES } from './reminder-template';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma:             PrismaService,
    private readonly reminderScheduler:  ReminderSchedulerService,
  ) {}

  async create(userId: string, dto: CreateTaskDto): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          userId,
          taskType: dto.taskType,
          title: dto.title,
          description: dto.description ?? null,
          payload:
            dto.payload !== undefined
              ? (dto.payload as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          priority: dto.priority ?? 3,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
          projectId: dto.projectId ?? null,
        },
      });

      // Historia inicial: de ningún estado a PENDING
      await tx.taskStatusHistory.create({
        data: {
          taskId: task.taskId,
          fromStatus: null,
          toStatus: 'PENDING',
          changedBy: 'SYSTEM',
        },
      });

      // Recordatorios automáticos si hay fecha límite
      if (dto.dueAt) {
        const templates = REMINDER_TEMPLATES[dto.taskType];
        if (templates?.length) {
          const dueAt = new Date(dto.dueAt);
          await tx.reminder.createMany({
            data: templates.map(({ minutesBefore }) => ({
              taskId: task.taskId,
              remindAt: new Date(dueAt.getTime() - minutesBefore * 60_000),
              status: 'SCHEDULED',
            })),
          });
        }
      }

      return task;
    });

    // Encolar delayed jobs para los reminders creados (fuera de la TX para no bloquearla)
    if (dto.dueAt) {
      const reminders = await this.prisma.reminder.findMany({
        where: { taskId: task.taskId, status: 'SCHEDULED' },
      });
      for (const r of reminders) {
        await this.reminderScheduler.scheduleReminder(r).catch((err: unknown) =>
          this.logger.warn(`No se pudo encolar reminder ${r.reminderId}`, err),
        );
      }
    }

    return task;
  }

  async findByUser(userId: string, activeOnly = true): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: {
        userId,
        ...(activeOnly ? { status: { notIn: ['DONE', 'CANCELLED'] } } : {}),
      },
      orderBy: [{ priority: 'asc' }, { dueAt: 'asc' }],
    });
  }

  async findOne(taskId: string, userId: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { taskId } });
    if (!task || task.userId !== userId) {
      throw new NotFoundException(`Tarea ${taskId} no encontrada`);
    }
    return task;
  }

  async updateStatus(
    taskId: string,
    userId: string,
    dto: UpdateTaskStatusDto,
  ): Promise<Task> {
    const current = await this.findOne(taskId, userId);
    const from = current.status as TaskStatus;
    const to = dto.toStatus;

    try {
      assertValidTransition(from, to);
    } catch (e) {
      if (e instanceof InvalidTransitionError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    if (to === 'DEFERRED' && !dto.newScheduledFor) {
      throw new BadRequestException(
        'newScheduledFor es requerido al postergar una tarea',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.task.update({
        where: { taskId },
        data: {
          status: to,
          ...(to === 'DONE' && { completedAt: new Date() }),
          ...(to === 'DEFERRED' && {
            deferCount: { increment: 1 },
            scheduledFor: new Date(dto.newScheduledFor!),
          }),
        },
      });

      await tx.taskStatusHistory.create({
        data: {
          taskId,
          fromStatus: from,
          toStatus: to,
          changedBy: dto.changedBy ?? 'USER',
          note: dto.note ?? null,
        },
      });

      return result;
    });

    // Cancelar reminders pendientes cuando la tarea finaliza
    if (to === 'DONE' || to === 'CANCELLED') {
      await this.reminderScheduler.cancelByTask(taskId).catch((err: unknown) =>
        this.logger.warn(`No se pudieron cancelar reminders de tarea ${taskId}`, err),
      );
    }

    return updated;
  }

  async update(taskId: string, userId: string, dto: UpdateTaskDto): Promise<Task> {
    await this.findOne(taskId, userId);

    return this.prisma.task.update({
      where: { taskId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.dueAt !== undefined && {
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        }),
        ...(dto.scheduledFor !== undefined && {
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        }),
        ...(dto.projectId !== undefined && { projectId: dto.projectId }),
        ...(dto.progressPct !== undefined && { progressPct: dto.progressPct }),
      },
    });
  }
}
