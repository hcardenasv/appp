import { Controller, Get, Query, UnauthorizedException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { PwaService } from '../pwa/pwa.service';

const ALL_STATUSES     = ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED', 'DEFERRED'];
const DEFAULT_STATUSES = ['PENDING', 'IN_PROGRESS', 'BLOCKED'];

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
        ? ALL_STATUSES
        : status
          ? status.split(',').filter((s) => ALL_STATUSES.includes(s))
          : DEFAULT_STATUSES;

    const fromDate = from ? new Date(from) : undefined;
    const toDate   = to   ? new Date(to)   : undefined;

    const tasks = await this.tasksService.findFiltered(userId, statuses, fromDate, toDate);

    return tasks.map((t) => ({
      taskId:      t.taskId,
      title:       t.title,
      status:      t.status,
      priority:    t.priority,
      scheduledFor: t.scheduledFor,
      dueAt:       t.dueAt,
      progressPct: t.progressPct,
      createdAt:   t.createdAt,
    }));
  }
}
