import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { PrismaService } from '../../database/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';

// Objeto tarea reutilizable
const makeTask = (overrides = {}) => ({
  taskId: 'uuid-task-1',
  userId: 'uuid-user-1',
  taskType: 'MEETING',
  title: 'Reunión de equipo',
  description: null,
  payload: null,
  status: 'PENDING',
  priority: 3,
  dueAt: null,
  scheduledFor: null,
  projectId: null,
  progressPct: null,
  completedAt: null,
  deferCount: 0,
  obsidianRef: null,
  createdAt: new Date('2026-07-13T10:00:00Z'),
  updatedAt: new Date('2026-07-13T10:00:00Z'),
  ...overrides,
});

describe('TasksService', () => {
  let service: TasksService;
  let prisma: jest.Mocked<PrismaService>;

  // Mock del cliente de transacción
  const makeTxMock = () => ({
    task: {
      create: jest.fn(),
      update: jest.fn(),
    },
    taskStatusHistory: { create: jest.fn() },
    reminder: { createMany: jest.fn() },
  });

  beforeEach(async () => {
    const mockPrisma = {
      task: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      taskStatusHistory: { create: jest.fn() },
      reminder: { createMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    prisma = module.get(PrismaService);
  });

  describe('create', () => {
    it('crea tarea sin dueAt sin generar recordatorios', async () => {
      const task = makeTask();
      const tx = makeTxMock();
      tx.task.create.mockResolvedValue(task);
      tx.taskStatusHistory.create.mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: typeof tx) => unknown) => fn(tx));

      const dto: CreateTaskDto = {
        taskType: 'MEETING',
        title: 'Reunión de equipo',
      };
      const result = await service.create('uuid-user-1', dto);

      expect(tx.task.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'uuid-user-1' }) }),
      );
      expect(tx.taskStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ toStatus: 'PENDING' }) }),
      );
      expect(tx.reminder.createMany).not.toHaveBeenCalled();
      expect(result).toEqual(task);
    });

    it('crea recordatorios automáticos cuando hay dueAt', async () => {
      const dueAt = '2026-07-20T15:00:00Z';
      const task = makeTask({ dueAt: new Date(dueAt) });
      const tx = makeTxMock();
      tx.task.create.mockResolvedValue(task);
      tx.taskStatusHistory.create.mockResolvedValue({});
      tx.reminder.createMany.mockResolvedValue({ count: 3 });
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: typeof tx) => unknown) => fn(tx));

      const dto: CreateTaskDto = {
        taskType: 'MEETING',
        title: 'Reunión con cliente',
        dueAt,
      };
      await service.create('uuid-user-1', dto);

      // MEETING tiene 3 recordatorios (1440, 60 y 10 minutos antes)
      expect(tx.reminder.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ status: 'SCHEDULED' })]) }),
      );
      const callArg = tx.reminder.createMany.mock.calls[0][0];
      expect(callArg.data).toHaveLength(3);
    });
  });

  describe('findOne', () => {
    it('lanza NotFoundException cuando la tarea no existe', async () => {
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne('no-existe', 'uuid-user-1')).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException cuando userId no coincide (aislamiento)', async () => {
      const task = makeTask({ userId: 'otro-usuario' });
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(task);
      await expect(service.findOne('uuid-task-1', 'uuid-user-1')).rejects.toThrow(NotFoundException);
    });

    it('retorna la tarea cuando existe y pertenece al usuario', async () => {
      const task = makeTask();
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(task);
      const result = await service.findOne('uuid-task-1', 'uuid-user-1');
      expect(result).toEqual(task);
    });
  });

  describe('updateStatus', () => {
    it('transición válida PENDING → IN_PROGRESS actualiza estado e inserta historial', async () => {
      const task = makeTask();
      const updatedTask = makeTask({ status: 'IN_PROGRESS' });
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(task);

      const tx = makeTxMock();
      tx.task.update.mockResolvedValue(updatedTask);
      tx.taskStatusHistory.create.mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: typeof tx) => unknown) => fn(tx));

      const dto: UpdateTaskStatusDto = { toStatus: 'IN_PROGRESS' };
      const result = await service.updateStatus('uuid-task-1', 'uuid-user-1', dto);

      expect(tx.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'IN_PROGRESS' }) }),
      );
      expect(tx.taskStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ fromStatus: 'PENDING', toStatus: 'IN_PROGRESS' }),
        }),
      );
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('transición inválida DONE → PENDING lanza BadRequestException', async () => {
      const task = makeTask({ status: 'DONE' });
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(task);

      const dto: UpdateTaskStatusDto = { toStatus: 'PENDING' };
      await expect(service.updateStatus('uuid-task-1', 'uuid-user-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('incrementa deferCount y actualiza scheduledFor al deferir', async () => {
      const task = makeTask({ status: 'IN_PROGRESS' });
      const newScheduledFor = '2026-07-25T09:00:00Z';
      const deferredTask = makeTask({ status: 'DEFERRED', deferCount: 1, scheduledFor: new Date(newScheduledFor) });

      (prisma.task.findUnique as jest.Mock).mockResolvedValue(task);
      const tx = makeTxMock();
      tx.task.update.mockResolvedValue(deferredTask);
      tx.taskStatusHistory.create.mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: typeof tx) => unknown) => fn(tx));

      const dto: UpdateTaskStatusDto = { toStatus: 'DEFERRED', newScheduledFor };
      await service.updateStatus('uuid-task-1', 'uuid-user-1', dto);

      expect(tx.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deferCount: { increment: 1 },
            scheduledFor: new Date(newScheduledFor),
          }),
        }),
      );
    });

    it('deferir sin newScheduledFor lanza BadRequestException', async () => {
      const task = makeTask({ status: 'IN_PROGRESS' });
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(task);

      const dto: UpdateTaskStatusDto = { toStatus: 'DEFERRED' };
      await expect(service.updateStatus('uuid-task-1', 'uuid-user-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('completedAt se establece al completar (DONE)', async () => {
      const task = makeTask({ status: 'IN_PROGRESS' });
      const completedTask = makeTask({ status: 'DONE', completedAt: new Date() });

      (prisma.task.findUnique as jest.Mock).mockResolvedValue(task);
      const tx = makeTxMock();
      tx.task.update.mockResolvedValue(completedTask);
      tx.taskStatusHistory.create.mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: typeof tx) => unknown) => fn(tx));

      const dto: UpdateTaskStatusDto = { toStatus: 'DONE' };
      await service.updateStatus('uuid-task-1', 'uuid-user-1', dto);

      const updateCall = tx.task.update.mock.calls[0][0];
      expect(updateCall.data.completedAt).toBeInstanceOf(Date);
    });
  });
});
