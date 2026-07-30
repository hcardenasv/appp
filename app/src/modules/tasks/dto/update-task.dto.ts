import { IsString, IsOptional, IsInt, Min, Max, IsISO8601, IsUUID } from 'class-validator';

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  priority?: number;

  @IsISO8601()
  @IsOptional()
  dueAt?: string | null;

  @IsISO8601()
  @IsOptional()
  scheduledFor?: string | null;

  @IsUUID()
  @IsOptional()
  projectId?: string | null;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  progressPct?: number | null;

  @IsString()
  @IsOptional()
  notes?: string | null;
}
