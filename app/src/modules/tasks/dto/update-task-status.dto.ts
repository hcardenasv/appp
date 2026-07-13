import { IsEnum, IsString, IsOptional, IsISO8601 } from 'class-validator';
import type { TaskStatus } from '../task-status.fsm';

const TASK_STATUSES: TaskStatus[] = [
  'PENDING', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED', 'DEFERRED',
];

export class UpdateTaskStatusDto {
  @IsEnum(TASK_STATUSES)
  toStatus!: TaskStatus;

  @IsString()
  @IsOptional()
  changedBy?: string;

  @IsString()
  @IsOptional()
  note?: string;

  // Requerido cuando toStatus === 'DEFERRED'. Validación semántica en el servicio.
  @IsISO8601()
  @IsOptional()
  newScheduledFor?: string;
}
