import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { IsEnum, IsOptional, IsString, IsISO8601 } from 'class-validator';
import { TasksService } from './tasks.service';
import { PwaService } from '../pwa/pwa.service';
import type { TaskStatus } from './task-status.fsm';

const ALL_STATUSES     = ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED', 'DEFERRED'] as const;
const DEFAULT_STATUSES = ['PENDING', 'IN_PROGRESS', 'BLOCKED'];

class WebStatusDto {
  @IsString()
  token!: string;

  @IsEnum(ALL_STATUSES)
  toStatus!: TaskStatus;

  @IsString()
  @IsOptional()
  note?: string;

  @IsISO8601()
  @IsOptional()
  deferTo?: string;
}

class WebNotesDto {
  @IsString()
  token!: string;

  @IsString()
  @IsOptional()
  notes?: string | null;
}

@Controller('tasks-api')
export class TasksWebController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly pwaService:   PwaService,
  ) {}

  @Get('list')
  async list(
    @Query('token')  token:   string,
    @Query('status') status?: string,
    @Query('from')   from?:   string,
    @Query('to')     to?:     string,
  ) {
    const userId = await this.pwaService.verifyWebSessionToken(token);
    if (!userId) throw new UnauthorizedException('Token inválido o expirado');

    const statuses =
      status === 'ALL'
        ? [...ALL_STATUSES]
        : status
          ? status.split(',').filter((s) => (ALL_STATUSES as readonly string[]).includes(s))
          : DEFAULT_STATUSES;

    const fromDate = from ? new Date(from) : undefined;
    const toDate   = to   ? new Date(to)   : undefined;

    const tasks = await this.tasksService.findFiltered(userId, statuses, fromDate, toDate);

    return tasks.map((t) => ({
      taskId:       t.taskId,
      title:        t.title,
      description:  t.description,
      notes:        t.notes ?? null,
      status:       t.status,
      priority:     t.priority,
      scheduledFor: t.scheduledFor,
      dueAt:        t.dueAt,
      progressPct:  t.progressPct,
      createdAt:    t.createdAt,
    }));
  }

  @Patch(':taskId/status')
  async updateStatus(
    @Param('taskId') taskId: string,
    @Body() body: WebStatusDto,
  ) {
    const userId = await this.pwaService.verifyWebSessionToken(body.token);
    if (!userId) throw new UnauthorizedException('Token inválido o expirado');

    if (!body.toStatus) throw new BadRequestException('toStatus es requerido');

    const updated = await this.tasksService.updateStatus(taskId, userId, {
      toStatus:        body.toStatus,
      note:            body.note,
      newScheduledFor: body.deferTo,
      changedBy:       'WEB',
    });

    return {
      taskId:  updated.taskId,
      status:  updated.status,
      message: 'Estado actualizado',
    };
  }

  @Patch(':taskId/notes')
  async updateNotes(
    @Param('taskId') taskId: string,
    @Body() body: WebNotesDto,
  ) {
    const userId = await this.pwaService.verifyWebSessionToken(body.token);
    if (!userId) throw new UnauthorizedException('Token inválido o expirado');

    const updated = await this.tasksService.update(taskId, userId, {
      notes: body.notes ?? null,
    });

    return {
      taskId:  updated.taskId,
      notes:   updated.notes ?? null,
      message: 'Observaciones guardadas',
    };
  }
}
