import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../database/prisma.service';
import type { User as TelegramUser } from 'grammy/types';

const makeUser = (overrides = {}) => ({
  userId: 'uuid-user-1',
  email: 'telegram_123@appp.local',
  displayName: 'Juan Pérez',
  timezone: 'America/Santiago',
  workdayStart: new Date('1970-01-01T08:30:00Z'),
  workdayEnd: new Date('1970-01-01T18:30:00Z'),
  workDays: [1, 2, 3, 4, 5],
  voiceEnabled: true,
  createdAt: new Date('2026-07-13T10:00:00Z'),
  ...overrides,
});

const makeTelegramUser = (overrides: Partial<TelegramUser> = {}): TelegramUser => ({
  id: 123456789,
  is_bot: false,
  first_name: 'Juan',
  last_name: 'Pérez',
  username: 'juanperez',
  ...overrides,
} as TelegramUser);

describe('UsersService', () => {
  let service: UsersService;
  let prisma: jest.Mocked<PrismaService>;

  const makeTxMock = () => ({
    user: { create: jest.fn() },
    channel: { create: jest.fn() },
  });

  beforeEach(async () => {
    const mockPrisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      channel: { findFirst: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService);
  });

  describe('findById', () => {
    it('retorna null si no existe', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await service.findById('no-existe')).toBeNull();
    });

    it('retorna el usuario si existe', async () => {
      const user = makeUser();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
      expect(await service.findById('uuid-user-1')).toEqual(user);
    });
  });

  describe('findByTelegramChatId', () => {
    it('retorna null si no hay canal TELEGRAM con ese chat_id', async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      expect(await service.findByTelegramChatId(999)).toBeNull();
    });

    it('retorna el usuario vinculado al canal', async () => {
      const user = makeUser();
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ user });
      const result = await service.findByTelegramChatId(123456789);
      expect(result).toEqual(user);
      expect(prisma.channel.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ channelType: 'TELEGRAM' }),
        }),
      );
    });
  });

  describe('findOrCreateFromTelegram', () => {
    it('devuelve usuario existente con isNew=false', async () => {
      const user = makeUser();
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ user });

      const result = await service.findOrCreateFromTelegram(makeTelegramUser());

      expect(result).toEqual({ user, isNew: false });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('crea usuario + canal en transacción y devuelve isNew=true', async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const user = makeUser();
      const tx = makeTxMock();
      tx.user.create.mockResolvedValue(user);
      tx.channel.create.mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation(
        (fn: (tx: ReturnType<typeof makeTxMock>) => unknown) => fn(tx),
      );

      const tgUser = makeTelegramUser({ id: 123456789, first_name: 'Juan', last_name: 'Pérez' });
      const result = await service.findOrCreateFromTelegram(tgUser);

      expect(result).toEqual({ user, isNew: true });
      expect(tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'telegram_123456789@appp.local',
            displayName: 'Juan Pérez',
          }),
        }),
      );
      expect(tx.channel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channelType: 'TELEGRAM',
            isVerified: true,
          }),
        }),
      );
    });

    it('usa solo first_name cuando no hay last_name', async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const user = makeUser({ displayName: 'Ana' });
      const tx = makeTxMock();
      tx.user.create.mockResolvedValue(user);
      tx.channel.create.mockResolvedValue({});
      (prisma.$transaction as jest.Mock).mockImplementation(
        (fn: (tx: ReturnType<typeof makeTxMock>) => unknown) => fn(tx),
      );

      const tgUser = makeTelegramUser({ first_name: 'Ana', last_name: undefined });
      await service.findOrCreateFromTelegram(tgUser);

      expect(tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ displayName: 'Ana' }),
        }),
      );
    });
  });
});
