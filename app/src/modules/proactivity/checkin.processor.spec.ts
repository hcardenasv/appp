import { Test, TestingModule } from '@nestjs/testing';
import { CheckinProcessor } from './checkin.processor';
import { PrismaService } from '../../database/prisma.service';
import { EngagementService } from './engagement.service';
import { TelegramSenderService } from './telegram-sender.service';
import { ENGAGEMENT_STATES } from './proactivity.constants';
import type { Job } from 'bullmq';

const makeUser = (overrides = {}) => ({
  userId:       'uuid-user-1',
  displayName:  'Juan Pérez',
  timezone:     'America/Santiago',
  workdayStart: new Date('1970-01-01T08:30:00Z'),
  workdayEnd:   new Date('1970-01-01T18:00:00Z'),
  workDays:     [1, 2, 3, 4, 5],
  email: 'telegram_123@appp.local',
  voiceEnabled: true,
  createdAt: new Date(),
  ...overrides,
});

const makeJob = (userId: string): Job<{ userId: string }> =>
  ({ data: { userId } }) as Job<{ userId: string }>;

describe('CheckinProcessor', () => {
  let processor: CheckinProcessor;
  let prisma: jest.Mocked<PrismaService>;
  let engagementService: jest.Mocked<EngagementService>;
  let telegramSender: jest.Mocked<TelegramSenderService>;

  beforeEach(async () => {
    const mockPrisma = {
      user:         { findUnique: jest.fn() },
      dailySession: { findUnique: jest.fn(), upsert: jest.fn() },
      task:         { findMany: jest.fn().mockResolvedValue([]) },
      channel:      { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckinProcessor,
        { provide: PrismaService,       useValue: mockPrisma },
        { provide: EngagementService,   useValue: { transitionState: jest.fn() } },
        { provide: TelegramSenderService, useValue: { getChatId: jest.fn(), sendText: jest.fn() } },
      ],
    }).compile();

    processor        = module.get<CheckinProcessor>(CheckinProcessor);
    prisma           = module.get(PrismaService);
    engagementService = module.get(EngagementService);
    telegramSender   = module.get(TelegramSenderService);
  });

  it('aborta si el usuario no existe', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await processor.process(makeJob('no-existe'));
    expect(prisma.dailySession.upsert).not.toHaveBeenCalled();
  });

  it('aborta si la sesión ya fue procesada (status != PENDING)', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeUser());
    (prisma.dailySession.findUnique as jest.Mock).mockResolvedValue({ status: 'COMPLETED' });

    await processor.process(makeJob('uuid-user-1'));

    expect(prisma.dailySession.upsert).not.toHaveBeenCalled();
    expect(telegramSender.sendText).not.toHaveBeenCalled();
  });

  it('crea sesión TRIGGERED y envía brief cuando la sesión no existe', async () => {
    const user = makeUser();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    (prisma.dailySession.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.dailySession.upsert as jest.Mock).mockResolvedValue({});
    (telegramSender.getChatId as jest.Mock).mockResolvedValue(123456789);
    (telegramSender.sendText as jest.Mock).mockResolvedValue(undefined);

    await processor.process(makeJob('uuid-user-1'));

    expect(prisma.dailySession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sessionType: 'CHECKIN', status: 'TRIGGERED' }),
      }),
    );
    expect(telegramSender.sendText).toHaveBeenCalledWith(
      123456789,
      expect.stringContaining('Buenos días'),
    );
    expect(engagementService.transitionState).toHaveBeenCalledWith(
      'uuid-user-1',
      ENGAGEMENT_STATES.AWAITING_CHECKIN,
    );
  });

  it('incluye tareas de arrastre en el brief', async () => {
    const user = makeUser();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    (prisma.dailySession.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.dailySession.upsert as jest.Mock).mockResolvedValue({});
    (telegramSender.getChatId as jest.Mock).mockResolvedValue(123456789);

    // Primera llamada (arrastre de ayer): 2 tareas
    // Segunda llamada (tareas de hoy): 0
    // Tercera llamada (atascadas): 0
    (prisma.task.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { title: 'Informe mensual', priority: 1, dueAt: null },
        { title: 'Llamar a Pérez', priority: 2, dueAt: null },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await processor.process(makeJob('uuid-user-1'));

    const sentText = (telegramSender.sendText as jest.Mock).mock.calls[0][1] as string;
    expect(sentText).toContain('Arrastre');
    expect(sentText).toContain('Informe mensual');
    expect(sentText).toContain('Llamar a Pérez');
  });

  it('no envía Telegram si no hay canal y no lanza error', async () => {
    const user = makeUser();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    (prisma.dailySession.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.dailySession.upsert as jest.Mock).mockResolvedValue({});
    (telegramSender.getChatId as jest.Mock).mockResolvedValue(null);

    await expect(processor.process(makeJob('uuid-user-1'))).resolves.toBeUndefined();
    expect(telegramSender.sendText).not.toHaveBeenCalled();
    // Pero sí cambia el estado de engagement
    expect(engagementService.transitionState).toHaveBeenCalled();
  });
});
