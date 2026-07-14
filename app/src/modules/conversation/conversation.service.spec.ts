import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ConversationService } from './conversation.service';
import { TasksService } from '../tasks/tasks.service';
import { PrismaService } from '../../database/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';

// Mock del SDK de Anthropic
jest.mock('@anthropic-ai/sdk');
const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

const makeUser = () => ({
  userId: 'uuid-user-1',
  email: 'telegram_123@appp.local',
  displayName: 'Juan Pérez',
  timezone: 'America/Santiago',
  workdayStart: new Date('1970-01-01T08:30:00Z'),
  workdayEnd: new Date('1970-01-01T18:30:00Z'),
  workDays: [1, 2, 3, 4, 5],
  voiceEnabled: true,
  createdAt: new Date('2026-07-13T10:00:00Z'),
});

const makeTask = (overrides = {}) => ({
  taskId: 'uuid-task-1',
  userId: 'uuid-user-1',
  taskType: 'GENERIC',
  title: 'Revisar informe',
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

// Respuesta de Claude con solo texto
const textResponse = (text: string) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
});

// Respuesta de Claude con tool_use
const toolUseResponse = (toolName: string, input: object, toolId = 'tool-1') => ({
  stop_reason: 'tool_use',
  content: [
    { type: 'tool_use', id: toolId, name: toolName, input },
  ],
});

describe('ConversationService', () => {
  let service: ConversationService;
  let tasksService: jest.Mocked<TasksService>;
  let prisma: jest.Mocked<PrismaService>;
  let mockCreate: jest.Mock;
  let mockRedis: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    mockCreate = jest.fn();
    MockAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic);

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    const mockTasks = {
      create: jest.fn(),
      findByUser: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      updateStatus: jest.fn(),
      update: jest.fn(),
    };

    const mockPrisma = {
      interactionLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def: string) => def),
            getOrThrow: jest.fn().mockReturnValue(''),
          },
        },
        { provide: TasksService, useValue: mockTasks },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<ConversationService>(ConversationService);
    tasksService = module.get(TasksService);
    prisma = module.get(PrismaService);
  });

  describe('processMessage — respuesta de texto', () => {
    it('retorna el texto de Claude directamente', async () => {
      mockCreate.mockResolvedValueOnce(textResponse('¡Tarea creada con éxito!'));
      const user = makeUser();

      const result = await service.processMessage(user as never, 'crear tarea', 'TELEGRAM');

      expect(result).toBe('¡Tarea creada con éxito!');
    });

    it('guarda session en Redis', async () => {
      mockCreate.mockResolvedValueOnce(textResponse('Entendido'));
      const user = makeUser();

      await service.processMessage(user as never, 'hola', 'TELEGRAM');

      expect(mockRedis.set).toHaveBeenCalledWith(
        `conv:session:${user.userId}`,
        expect.any(String),
        'EX',
        1800,
      );
    });

    it('registra interaction_log INBOUND y OUTBOUND', async () => {
      mockCreate.mockResolvedValueOnce(textResponse('ok'));
      const user = makeUser();

      await service.processMessage(user as never, 'hola', 'TELEGRAM');

      expect(prisma.interactionLog.create).toHaveBeenCalledTimes(2);
      const calls = (prisma.interactionLog.create as jest.Mock).mock.calls;
      const directions = calls.map((c: { data: { direction: string } }[]) => c[0].data.direction);
      expect(directions).toContain('INBOUND');
      expect(directions).toContain('OUTBOUND');
    });
  });

  describe('processMessage — tool use: create_task', () => {
    it('delega a TasksService.create y retorna confirmación', async () => {
      const task = makeTask({ title: 'Llamar a Pérez' });
      (tasksService.create as jest.Mock).mockResolvedValue(task);

      // 1ª llamada: Claude pide tool_use; 2ª llamada: Claude da respuesta texto
      mockCreate
        .mockResolvedValueOnce(toolUseResponse('create_task', { taskType: 'PHONE_CALL', title: 'Llamar a Pérez' }))
        .mockResolvedValueOnce(textResponse('Tarea "Llamar a Pérez" creada.'));

      const user = makeUser();
      const result = await service.processMessage(user as never, 'recuérdame llamar a Pérez', 'TELEGRAM');

      expect(tasksService.create).toHaveBeenCalledWith(
        user.userId,
        expect.objectContaining({ taskType: 'PHONE_CALL', title: 'Llamar a Pérez' }),
      );
      expect(result).toBe('Tarea "Llamar a Pérez" creada.');
    });
  });

  describe('processMessage — tool use: get_daily_summary', () => {
    it('formatea las tareas del usuario y las envía a Claude', async () => {
      const tasks = [makeTask(), makeTask({ taskId: 'uuid-task-2', title: 'Preparar presentación', status: 'IN_PROGRESS' })];
      (tasksService.findByUser as jest.Mock).mockResolvedValue(tasks);

      mockCreate
        .mockResolvedValueOnce(toolUseResponse('get_daily_summary', {}))
        .mockResolvedValueOnce(textResponse('Tienes 2 tareas activas.'));

      const user = makeUser();
      const result = await service.processMessage(user as never, '¿qué tengo pendiente?', 'TELEGRAM');

      expect(result).toBe('Tienes 2 tareas activas.');
      // El tool_result debe incluir el count (content es string JSON dentro del MessageParam)
      const secondCall = mockCreate.mock.calls[1][0];
      const toolResultMsg = secondCall.messages.find(
        (m: { role: string; content: unknown }) =>
          m.role === 'user' && Array.isArray(m.content),
      ) as { role: string; content: Array<{ type: string; content: string }> };
      const resultContent = JSON.parse(toolResultMsg.content[0].content) as { count: number };
      expect(resultContent.count).toBe(2);
    });
  });

  describe('processMessage — tool use: log_progress', () => {
    it('llama a TasksService.update con progressPct', async () => {
      const task = makeTask({ progressPct: 50 });
      (tasksService.update as jest.Mock).mockResolvedValue(task);

      mockCreate
        .mockResolvedValueOnce(toolUseResponse('log_progress', { taskId: 'uuid-task-1', progressPct: 50 }))
        .mockResolvedValueOnce(textResponse('Progreso registrado: 50%.'));

      const user = makeUser();
      await service.processMessage(user as never, 'avancé el 50% en el informe', 'TELEGRAM');

      expect(tasksService.update).toHaveBeenCalledWith(
        'uuid-task-1',
        user.userId,
        { progressPct: 50 },
      );
    });
  });

  describe('processMessage — errores', () => {
    it('retorna mensaje de fallback si la API de Claude falla', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const user = makeUser();
      const result = await service.processMessage(user as never, 'hola', 'TELEGRAM');

      expect(result).toContain('problema procesando tu mensaje');
    });

    it('session previa de Redis se carga y se pasa a Claude', async () => {
      const prevMessages = [
        { role: 'user', content: 'mensaje anterior' },
        { role: 'assistant', content: 'respuesta anterior' },
      ];
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(prevMessages));
      mockCreate.mockResolvedValueOnce(textResponse('ok'));

      const user = makeUser();
      await service.processMessage(user as never, 'nuevo mensaje', 'TELEGRAM');

      const firstCall = mockCreate.mock.calls[0][0];
      // La sesión cargada debe aparecer en los mensajes enviados a Claude
      expect(firstCall.messages.length).toBeGreaterThanOrEqual(3);
      expect(firstCall.messages[0].content).toBe('mensaje anterior');
    });
  });
});
