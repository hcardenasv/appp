import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService, DailyMetrics } from './reports.service';
import { PrismaService } from '../../database/prisma.service';
import { TelegramSenderService } from '../proactivity/telegram-sender.service';
import { EngagementService } from '../proactivity/engagement.service';

const mockPrisma = () => ({
  user: { findUnique: jest.fn() },
  task: { findMany: jest.fn(), count: jest.fn() },
  dailySession: { findUnique: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  report: { findUnique: jest.fn(), create: jest.fn() },
});

const mockTelegramSender = {
  getChatId: jest.fn(),
  sendText:  jest.fn(),
};

const mockEngagementService = {
  transitionState: jest.fn(),
};

const makeUser = (overrides = {}) => ({
  userId:       'uuid-user-1',
  displayName:  'Juan Pérez',
  timezone:     'America/Santiago',
  workdayStart: new Date('1970-01-01T08:30:00Z'),
  workdayEnd:   new Date('1970-01-01T18:30:00Z'),
  workDays:     [1, 2, 3, 4, 5],
  email:        'juan@example.com',
  voiceEnabled: true,
  createdAt:    new Date(),
  ...overrides,
});

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma:  ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    prisma = mockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService,        useValue: prisma },
        { provide: TelegramSenderService, useValue: mockTelegramSender },
        { provide: EngagementService,    useValue: mockEngagementService },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    jest.clearAllMocks();
  });

  describe('calculateMetrics', () => {
    it('calcula métricas correctamente con tareas mixtas', async () => {
      prisma.task.findMany.mockResolvedValue([
        { title: 'Tarea A', status: 'DONE' },
        { title: 'Tarea B', status: 'DONE' },
        { title: 'Tarea C', status: 'DEFERRED' },
        { title: 'Tarea D', status: 'CANCELLED' },
        { title: 'Tarea E', status: 'PENDING' },
      ]);

      const metrics = await service.calculateMetrics('uuid-user-1', 'America/Santiago');

      expect(metrics.planned).toBe(5);
      expect(metrics.done).toBe(2);
      expect(metrics.deferred).toBe(1);
      expect(metrics.cancelled).toBe(1);
      expect(metrics.pendingStillOpen).toBe(1);
      expect(metrics.completionRate).toBe(40);
      expect(metrics.doneTaskTitles).toEqual(['Tarea A', 'Tarea B']);
    });

    it('devuelve completionRate=0 cuando no hay tareas planificadas', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      const metrics = await service.calculateMetrics('uuid-user-1', 'America/Santiago');
      expect(metrics.planned).toBe(0);
      expect(metrics.completionRate).toBe(0);
    });

    it('completionRate=100 cuando todas las tareas están DONE', async () => {
      prisma.task.findMany.mockResolvedValue([
        { title: 'T1', status: 'DONE' },
        { title: 'T2', status: 'DONE' },
      ]);
      const metrics = await service.calculateMetrics('uuid-user-1', 'America/Santiago');
      expect(metrics.completionRate).toBe(100);
      expect(metrics.pendingStillOpen).toBe(0);
    });
  });

  describe('calculateStreak', () => {
    it('devuelve 0 cuando no hay sesiones completadas', async () => {
      prisma.dailySession.findMany.mockResolvedValue([]);
      const streak = await service.calculateStreak('uuid-user-1', 'America/Santiago');
      expect(streak).toBe(0);
    });

    it('cuenta días consecutivos con ambas sesiones completas', async () => {
      // Simular hoy y ayer con ambas sesiones completadas
      const today     = new Date();
      const yesterday = new Date(today);
      yesterday.setUTCDate(today.getUTCDate() - 1);

      // Usar fechas locales correctas para America/Santiago
      const todayDate     = new Date(new Intl.DateTimeFormat('sv', { timeZone: 'America/Santiago' }).format(today) + 'T00:00:00Z');
      const yesterdayDate = new Date(new Intl.DateTimeFormat('sv', { timeZone: 'America/Santiago' }).format(yesterday) + 'T00:00:00Z');

      prisma.dailySession.findMany.mockResolvedValue([
        { sessionDate: todayDate,     sessionType: 'CHECKIN'  },
        { sessionDate: todayDate,     sessionType: 'CHECKOUT' },
        { sessionDate: yesterdayDate, sessionType: 'CHECKIN'  },
        { sessionDate: yesterdayDate, sessionType: 'CHECKOUT' },
      ]);

      const streak = await service.calculateStreak('uuid-user-1', 'America/Santiago');
      expect(streak).toBe(2);
    });

    it('rompe la racha si falta una de las sesiones', async () => {
      const today = new Date();
      const todayDate = new Date(new Intl.DateTimeFormat('sv', { timeZone: 'America/Santiago' }).format(today) + 'T00:00:00Z');

      // Solo CHECKIN hoy (falta CHECKOUT)
      prisma.dailySession.findMany.mockResolvedValue([
        { sessionDate: todayDate, sessionType: 'CHECKIN' },
      ]);

      const streak = await service.calculateStreak('uuid-user-1', 'America/Santiago');
      expect(streak).toBe(0);
    });
  });

  describe('formatReport', () => {
    const user = makeUser();

    it('incluye métricas cuando hay tareas planificadas', () => {
      const metrics: DailyMetrics = {
        planned: 4, done: 3, deferred: 1, cancelled: 0,
        completionRate: 75, doneTaskTitles: ['T1', 'T2', 'T3'], pendingStillOpen: 0,
      };
      const text = service.formatReport(user, metrics, 2, false);
      expect(text).toContain('3 de 4 (75%)');
      expect(text).toContain('⏭ Postergadas: 1');
      expect(text).toContain('🔥');
      expect(text).toContain('2 días');
      expect(text).toContain('T1');
    });

    it('indica sesión perdida cuando missed=true', () => {
      const metrics: DailyMetrics = {
        planned: 2, done: 0, deferred: 0, cancelled: 0,
        completionRate: 0, doneTaskTitles: [], pendingStillOpen: 2,
      };
      const text = service.formatReport(user, metrics, 0, true);
      expect(text).toContain('No se completó el check-out');
      expect(text).toContain('Hasta mañana');
    });

    it('muestra mensaje positivo con completionRate >= 80', () => {
      const metrics: DailyMetrics = {
        planned: 5, done: 5, deferred: 0, cancelled: 0,
        completionRate: 100, doneTaskTitles: ['T1', 'T2', 'T3', 'T4', 'T5'], pendingStillOpen: 0,
      };
      const text = service.formatReport(user, metrics, 0, false);
      expect(text).toContain('Excelente');
    });

    it('no muestra racha cuando streak=0', () => {
      const metrics: DailyMetrics = {
        planned: 1, done: 1, deferred: 0, cancelled: 0,
        completionRate: 100, doneTaskTitles: ['T1'], pendingStillOpen: 0,
      };
      const text = service.formatReport(user, metrics, 0, false);
      expect(text).not.toContain('🔥');
    });
  });

  describe('calcPeriodMetrics', () => {
    it('calcula correctamente con tareas mixtas', async () => {
      const mon = new Date('2026-07-13T00:00:00Z');
      const sun = new Date('2026-07-20T00:00:00Z');
      prisma.task.findMany.mockResolvedValue([
        { status: 'DONE',      completedAt: new Date('2026-07-14T10:00:00Z') },
        { status: 'DONE',      completedAt: new Date('2026-07-14T11:00:00Z') },
        { status: 'DEFERRED',  completedAt: null },
        { status: 'CANCELLED', completedAt: null },
      ]);

      const metrics = await service.calcPeriodMetrics('uuid-user-1', {
        gte: mon, lt: sun, dateGte: mon, dateLt: sun,
      });

      expect(metrics.planned).toBe(4);
      expect(metrics.done).toBe(2);
      expect(metrics.deferred).toBe(1);
      expect(metrics.cancelled).toBe(1);
      expect(metrics.completionRate).toBe(50);
      expect(metrics.bestDay).toBeTruthy();
    });

    it('devuelve completionRate=0 si no hay tareas', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      const metrics = await service.calcPeriodMetrics('uuid-user-1', {
        gte: new Date(), lt: new Date(), dateGte: new Date(), dateLt: new Date(),
      });
      expect(metrics.completionRate).toBe(0);
      expect(metrics.bestDay).toBeNull();
    });
  });

  describe('formatWeeklyReport', () => {
    const user = makeUser();

    it('muestra tendencia positiva cuando mejora respecto a semana anterior', () => {
      const metrics = { planned: 5, done: 4, deferred: 1, cancelled: 0, completionRate: 80, bestDay: 'martes' };
      const text = service.formatWeeklyReport(user, metrics, 60, 3, '14–20 jul');
      expect(text).toContain('📈');
      expect(text).toContain('+20%');
      expect(text).toContain('martes');
      expect(text).toContain('🔥');
    });

    it('muestra tendencia negativa cuando empeora', () => {
      const metrics = { planned: 5, done: 2, deferred: 3, cancelled: 0, completionRate: 40, bestDay: null };
      const text = service.formatWeeklyReport(user, metrics, 80, 0, '14–20 jul');
      expect(text).toContain('📉');
      expect(text).toContain('-40%');
    });

    it('mensaje positivo con completionRate >= 80', () => {
      const metrics = { planned: 5, done: 4, deferred: 0, cancelled: 0, completionRate: 80, bestDay: null };
      const text = service.formatWeeklyReport(user, metrics, 0, 0, '14–20 jul');
      expect(text).toContain('Excelente');
    });

    it('muestra texto por defecto sin tareas planificadas', () => {
      const metrics = { planned: 0, done: 0, deferred: 0, cancelled: 0, completionRate: 0, bestDay: null };
      const text = service.formatWeeklyReport(user, metrics, 0, 0, '14–20 jul');
      expect(text).toContain('No hubo tareas planificadas');
    });
  });

  describe('formatMonthlyReport', () => {
    const user = makeUser();

    it('incluye adherencia y mejor racha cuando > 0', () => {
      const metrics = { planned: 20, done: 16, deferred: 4, cancelled: 0, completionRate: 80, bestDay: null };
      const text = service.formatMonthlyReport(user, metrics, 90, 10, 'julio 2026');
      expect(text).toContain('90%');
      expect(text).toContain('10 días');
    });

    it('no muestra racha ni adherencia cuando son 0', () => {
      const metrics = { planned: 5, done: 2, deferred: 0, cancelled: 3, completionRate: 40, bestDay: null };
      const text = service.formatMonthlyReport(user, metrics, 0, 0, 'julio 2026');
      expect(text).not.toContain('Adherencia');
      expect(text).not.toContain('Mejor racha');
    });
  });

  describe('generateWeeklyReport', () => {
    it('no genera si el reporte ya existe (idempotencia)', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.report.findUnique.mockResolvedValue({ reportId: 'existing' });

      await service.generateWeeklyReport('uuid-user-1');

      expect(prisma.task.findMany).not.toHaveBeenCalled();
      expect(mockTelegramSender.sendText).not.toHaveBeenCalled();
    });

    it('genera, persiste y envía el reporte semanal si no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.report.findUnique.mockResolvedValue(null);
      prisma.task.findMany.mockResolvedValue([
        { status: 'DONE', completedAt: new Date() },
      ]);
      prisma.dailySession.findMany.mockResolvedValue([]);
      prisma.report.create.mockResolvedValue({});
      mockTelegramSender.getChatId.mockResolvedValue(123456);
      mockTelegramSender.sendText.mockResolvedValue(undefined);

      await service.generateWeeklyReport('uuid-user-1');

      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ periodType: 'WEEKLY' }) }),
      );
      expect(mockTelegramSender.sendText).toHaveBeenCalled();
    });
  });

  describe('generateMonthlyReport', () => {
    it('no genera si el reporte ya existe (idempotencia)', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.report.findUnique.mockResolvedValue({ reportId: 'existing' });

      await service.generateMonthlyReport('uuid-user-1');

      expect(prisma.task.findMany).not.toHaveBeenCalled();
    });

    it('genera, persiste y envía el reporte mensual si no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.report.findUnique.mockResolvedValue(null);
      prisma.task.findMany.mockResolvedValue([]);
      prisma.dailySession.findMany.mockResolvedValue([]);
      prisma.report.create.mockResolvedValue({});
      mockTelegramSender.getChatId.mockResolvedValue(123456);
      mockTelegramSender.sendText.mockResolvedValue(undefined);

      await service.generateMonthlyReport('uuid-user-1');

      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ periodType: 'MONTHLY' }) }),
      );
      expect(mockTelegramSender.sendText).toHaveBeenCalled();
    });
  });

  describe('generateAndSend', () => {
    it('no genera si el reporte ya existe (idempotencia)', async () => {
      prisma.report.findUnique.mockResolvedValue({ reportId: 'existing' });
      const user = makeUser();
      await service.generateAndSend('uuid-user-1', user, new Date(), false);
      expect(prisma.task.findMany).not.toHaveBeenCalled();
      expect(mockTelegramSender.sendText).not.toHaveBeenCalled();
    });

    it('genera reporte, lo persiste y lo envía si no existe', async () => {
      prisma.report.findUnique.mockResolvedValue(null);
      prisma.task.findMany.mockResolvedValue([{ title: 'T1', status: 'DONE' }]);
      prisma.dailySession.findMany.mockResolvedValue([]);
      prisma.dailySession.updateMany.mockResolvedValue({ count: 1 });
      prisma.report.create.mockResolvedValue({});
      mockTelegramSender.getChatId.mockResolvedValue(123456);
      mockTelegramSender.sendText.mockResolvedValue(undefined);
      mockEngagementService.transitionState.mockResolvedValue(undefined);

      await service.generateAndSend('uuid-user-1', makeUser(), new Date(), false);

      expect(prisma.report.create).toHaveBeenCalled();
      expect(mockTelegramSender.sendText).toHaveBeenCalled();
      expect(mockEngagementService.transitionState).toHaveBeenCalled();
    });
  });
});
