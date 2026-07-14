import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from './notification.service';

interface ReminderJobData {
  reminderId: string;
}

@Injectable()
export class ReminderProcessor {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async process(job: Job<ReminderJobData>): Promise<void> {
    const { reminderId } = job.data;

    const reminder = await this.prisma.reminder.findUnique({
      where:   { reminderId },
      include: { task: true },
    });

    if (!reminder) {
      this.logger.warn(`Reminder ${reminderId} no encontrado`);
      return;
    }

    // Idempotencia: si ya fue procesado o cancelado, salir sin error
    if (reminder.status !== 'SCHEDULED') {
      this.logger.debug(`Reminder ${reminderId} en estado ${reminder.status} — omitido`);
      return;
    }

    // Marcar como FIRED antes de enviar (evita reenvío en retry)
    await this.prisma.reminder.update({
      where: { reminderId },
      data:  { status: 'FIRED' },
    });

    const task = reminder.task;
    if (!task) {
      this.logger.warn(`Reminder ${reminderId} sin tarea asociada — omitido`);
      return;
    }

    const dueStr = task.dueAt
      ? `Vence: ${task.dueAt.toLocaleString('es-CL')}`
      : '';

    await this.notifications.send({
      userId:    task.userId,
      sourceType: 'REMINDER',
      sourceId:  reminderId,
      title:     `⏰ ${task.title}`,
      body:      [task.description, dueStr].filter(Boolean).join('\n') || task.title,
      dedupKey:  `reminder:${reminderId}`,
    });

    this.logger.log(`Reminder ${reminderId} disparado para tarea ${task.taskId}`);
  }
}
