import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsISO8601,
  IsUUID,
  IsObject,
} from 'class-validator';

export const TASK_TYPES = [
  'EMAIL_SEND',
  'REPORT',
  'PHONE_CALL',
  'MEETING',
  'DEADLINE',
  'AGREEMENT',
  'PROJECT_MILESTONE',
  'GENERIC',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export class CreateTaskDto {
  @IsEnum(TASK_TYPES)
  taskType!: TaskType;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  priority?: number;

  @IsISO8601()
  @IsOptional()
  dueAt?: string;

  @IsISO8601()
  @IsOptional()
  scheduledFor?: string;

  @IsUUID()
  @IsOptional()
  projectId?: string;
}
