import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Reminder } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { QueueService } from '../proactivity/queue.service';
import { RECONCILE_WINDOW_MS, REMINDER_JOB_FIRE } from './notifications.constants';

@Injectable()
export class ReminderSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ReminderSchedulerService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly queues:  QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile();
  }

  /** Encola delayed jobs para todos los reminders SCHEDULED en los próximos 7 días. */
  async reconcile(): Promise<void> {
    const cutoff = new Date(Date.now() + RECONCILE_WINDOW_MS);
    const reminders = await this.prisma.reminder.findMany({
      where: { status: 'SCHEDULED', remindAt: { gte: new Date(), lte: cutoff } },
    });

    let scheduled = 0;
    for (const r of reminders) {
      await this.scheduleReminder(r).catch((err: unknown) =>
        this.logger.warn(`No se pudo encolar reminder ${r.reminderId}`, err),
      );
      scheduled++;
    }

    if (scheduled > 0) {
      this.logger.log(`Reconciliación: ${scheduled} reminders encolados`);
    }
  }

  /**
   * Crea un delayed BullMQ job para el reminder y persiste el jobId.
   * Idempotente: usa jobId fijo `reminder-{reminderId}`.
   * NOTA: BullMQ v5 prohíbe ':' en jobIds custom — se usa '-' como separador.
   */
  async scheduleReminder(reminder: Reminder): Promise<void> {
    const delay = Math.max(0, reminder.remindAt.getTime() - Date.now());
    const jobId = `reminder-${reminder.reminderId}`;

    const job = await this.queues.reminders.add(
      REMINDER_JOB_FIRE,
      { reminderId: reminder.reminderId },
      { delay, jobId, removeOnComplete: true, removeOnFail: 3 },
    );

    await this.prisma.reminder.update({
      where: { reminderId: reminder.reminderId },
      data:  { jobId: job.id?.toString() ?? jobId },
    });
  }

  /**
   * Marca el reminder como CANCELLED en la BD.
   * El job BullMQ eventualmente dispara pero ReminderProcessor lo descarta
   * porque status !== 'SCHEDULED'.
   */
  async cancelReminder(reminderId: string): Promise<void> {
    await this.prisma.reminder.updateMany({
      where:  { reminderId, status: 'SCHEDULED' },
      data:   { status: 'CANCELLED' },
    });
  }

  /**
   * Cancela todos los reminders SCHEDULED de una tarea (llamado cuando la tarea
   * pasa a DONE o CANCELLED).
   */
  async cancelByTask(taskId: string): Promise<void> {
    await this.prisma.reminder.updateMany({
      where: { taskId, status: 'SCHEDULED' },
      data:  { status: 'CANCELLED' },
    });
  }
}
