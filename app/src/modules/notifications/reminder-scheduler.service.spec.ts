import { Test } from '@nestjs/testing';
import type { Reminder } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { QueueService } from '../proactivity/queue.service';
import { ReminderSchedulerService } from './reminder-scheduler.service';

const mockJob = { id: 'bullmq-job-123' };

const mockRemindersQueue = {
  add: jest.fn().mockResolvedValue(mockJob),
};

const mockQueueService = { reminders: mockRemindersQueue };

const makeReminder = (overrides: Partial<Reminder> = {}): Reminder =>
  ({
    reminderId:       'rem-abc',
    taskId:           'task-1',
    eventId:          null,
    remindAt:         new Date(Date.now() + 60_000),
    rule:             null,
    escalationPolicy: null,
    status:           'SCHEDULED',
    jobId:            null,
    ...overrides,
  } as Reminder);

const mockPrisma = {
  reminder: {
    findMany:   jest.fn(),
    update:     jest.fn(),
    updateMany: jest.fn(),
  },
};

describe('ReminderSchedulerService', () => {
  let service: ReminderSchedulerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRemindersQueue.add.mockResolvedValue(mockJob);

    const module = await Test.createTestingModule({
      providers: [
        ReminderSchedulerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QueueService,  useValue: mockQueueService },
      ],
    })
      // Deshabilitar onModuleInit en los tests para no llamar a reconcile automáticamente
      .overrideProvider(ReminderSchedulerService)
      .useFactory({
        factory: (prisma: typeof mockPrisma, queues: typeof mockQueueService) =>
          new (ReminderSchedulerService as unknown as new (
            p: typeof mockPrisma,
            q: typeof mockQueueService,
          ) => ReminderSchedulerService)(prisma, queues),
        inject: [PrismaService, QueueService],
      })
      .compile();

    service = module.get(ReminderSchedulerService);
  });

  describe('scheduleReminder', () => {
    it('crea un delayed job con jobId idempotente', async () => {
      const reminder = makeReminder();
      mockPrisma.reminder.update.mockResolvedValue({});

      await service.scheduleReminder(reminder);

      expect(mockRemindersQueue.add).toHaveBeenCalledWith(
        'fire-reminder',
        { reminderId: reminder.reminderId },
        expect.objectContaining({ jobId: `reminder:${reminder.reminderId}` }),
      );
    });

    it('persiste el jobId retornado por BullMQ en la BD', async () => {
      const reminder = makeReminder();
      mockPrisma.reminder.update.mockResolvedValue({});

      await service.scheduleReminder(reminder);

      expect(mockPrisma.reminder.update).toHaveBeenCalledWith({
        where: { reminderId: reminder.reminderId },
        data:  { jobId: 'bullmq-job-123' },
      });
    });

    it('usa delay=0 si remindAt ya pasó', async () => {
      const reminder = makeReminder({ remindAt: new Date(Date.now() - 5_000) });
      mockPrisma.reminder.update.mockResolvedValue({});

      await service.scheduleReminder(reminder);

      const callOpts = mockRemindersQueue.add.mock.calls[0][2] as { delay: number };
      expect(callOpts.delay).toBe(0);
    });
  });

  describe('cancelReminder', () => {
    it('marca el reminder como CANCELLED en la BD', async () => {
      mockPrisma.reminder.updateMany.mockResolvedValue({ count: 1 });

      await service.cancelReminder('rem-to-cancel');

      expect(mockPrisma.reminder.updateMany).toHaveBeenCalledWith({
        where: { reminderId: 'rem-to-cancel', status: 'SCHEDULED' },
        data:  { status: 'CANCELLED' },
      });
    });
  });

  describe('cancelByTask', () => {
    it('cancela todos los reminders SCHEDULED de una tarea', async () => {
      mockPrisma.reminder.updateMany.mockResolvedValue({ count: 2 });

      await service.cancelByTask('task-xyz');

      expect(mockPrisma.reminder.updateMany).toHaveBeenCalledWith({
        where: { taskId: 'task-xyz', status: 'SCHEDULED' },
        data:  { status: 'CANCELLED' },
      });
    });
  });

  describe('reconcile', () => {
    it('encola un job por cada reminder SCHEDULED en los próximos 7 días', async () => {
      const reminders = [makeReminder({ reminderId: 'r1' }), makeReminder({ reminderId: 'r2' })];
      mockPrisma.reminder.findMany.mockResolvedValue(reminders);
      mockPrisma.reminder.update.mockResolvedValue({});

      await service.reconcile();

      expect(mockRemindersQueue.add).toHaveBeenCalledTimes(2);
    });

    it('no lanza si un reminder individual falla al encolar', async () => {
      mockPrisma.reminder.findMany.mockResolvedValue([makeReminder({ reminderId: 'r-fail' })]);
      mockRemindersQueue.add.mockRejectedValueOnce(new Error('Redis down'));

      await expect(service.reconcile()).resolves.not.toThrow();
    });
  });
});
