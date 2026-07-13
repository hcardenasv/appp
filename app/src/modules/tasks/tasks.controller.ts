import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

// Temporal hasta Hito 3 (autenticación real). El userId se lee del header x-user-id.
function requireUserId(rawHeader: string | undefined): string {
  if (!rawHeader) {
    throw new UnauthorizedException('Header x-user-id requerido');
  }
  return rawHeader;
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  create(
    @Headers('x-user-id') userIdHeader: string | undefined,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreateTaskDto,
  ) {
    return this.tasksService.create(requireUserId(userIdHeader), dto);
  }

  @Get()
  findAll(
    @Headers('x-user-id') userIdHeader: string | undefined,
    @Query('all') all?: string,
  ) {
    const activeOnly = all !== 'true';
    return this.tasksService.findByUser(requireUserId(userIdHeader), activeOnly);
  }

  @Get(':id')
  findOne(
    @Headers('x-user-id') userIdHeader: string | undefined,
    @Param('id', ParseUUIDPipe) taskId: string,
  ) {
    return this.tasksService.findOne(taskId, requireUserId(userIdHeader));
  }

  @Patch(':id')
  update(
    @Headers('x-user-id') userIdHeader: string | undefined,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(taskId, requireUserId(userIdHeader), dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Headers('x-user-id') userIdHeader: string | undefined,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateTaskStatusDto,
  ) {
    return this.tasksService.updateStatus(taskId, requireUserId(userIdHeader), dto);
  }
}
