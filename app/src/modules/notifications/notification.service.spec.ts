import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { TelegramSenderService } from '../proactivity/telegram-sender.service';
import { QueueService } from '../proactivity/queue.service';
import { EmailService } from './email.service';
import { WebPushService } from '../pwa/web-push.service';
import { NotificationService, SendNotificationInput } from './notification.service';

const mockPrisma = {
  notification:         { findFirst: jest.fn(), create: jest.fn() },
  notificationDelivery: { create: jest.fn(), update: jest.fn() },
  user:                 { findUnique: jest.fn() },
};

const mockTelegram = {
  getChatId: jest.fn(),
  sendText:  jest.fn(),
};

const mockEmail    = { send: jest.fn(), sendHtml: jest.fn(), isConfigured: jest.fn(() => false), isRealEmail: jest.fn(() => false) };
const mockWebPush  = { isConfigured: jest.fn(() => false), sendToUser: jest.fn() };
const mockRedis    = { incr: jest.fn(), expire: jest.fn() };
const mockQueueService = { escalation: { add: jest.fn() } };

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService,          useValue: mockPrisma },
        { provide: TelegramSenderService,  useValue: mockTelegram },
        { provide: EmailService,           useValue: mockEmail },
        { provide: WebPushService,         useValue: mockWebPush },
        { provide: QueueService,           useValue: mockQueueService },
        { provide: REDIS_CLIENT,           useValue: mockRedis },
      ],
    }).compile();

    service = module.get(NotificationService);
  });

  const baseInput: SendNotificationInput = {
    userId:     'user-1',
    sourceType: 'REMINDER',
    sourceId:   'rem-1',
    title:      'Reunión',
    body:       'Descripción',
    dedupKey:   'reminder:rem-1',
  };

  describe('dedup', () => {
    it('omite envío si ya existe notificación con la misma dedupKey', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue({ notificationId: 'existing' });

      await service.send(baseInput);

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(mockTelegram.sendText).not.toHaveBeenCalled();
    });

    it('envía si no existe notificación previa', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      mockPrisma.notification.create.mockResolvedValue({ notificationId: 'new-1' });
      mockTelegram.getChatId.mockResolvedValue(12345);
      mockPrisma.notificationDelivery.create.mockResolvedValue({ deliveryId: BigInt(1) });
      mockTelegram.sendText.mockResolvedValue(undefined);
      mockPrisma.notificationDelivery.update.mockResolvedValue({});

      await service.send(baseInput);

      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
      expect(mockTelegram.sendText).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate limit', () => {
    it('bloquea el envío si se supera el límite por hora', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(21); // > MAX_NOTIFICATIONS_PER_HOUR (20)

      await service.send(baseInput);

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('permite el envío en el límite exacto', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(20);
      mockRedis.expire.mockResolvedValue(1);
      mockPrisma.notification.create.mockResolvedValue({ notificationId: 'new-2' });
      mockTelegram.getChatId.mockResolvedValue(99999);
      mockPrisma.notificationDelivery.create.mockResolvedValue({ deliveryId: BigInt(2) });
      mockTelegram.sendText.mockResolvedValue(undefined);
      mockPrisma.notificationDelivery.update.mockResolvedValue({});

      await service.send(baseInput);

      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('selección de canal', () => {
    beforeEach(() => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      mockPrisma.notification.create.mockResolvedValue({ notificationId: 'new-3' });
      mockPrisma.notificationDelivery.create.mockResolvedValue({ deliveryId: BigInt(3) });
      mockPrisma.notificationDelivery.update.mockResolvedValue({});
    });

    it('envía por Telegram si hay chatId disponible', async () => {
      mockTelegram.getChatId.mockResolvedValue(55555);
      mockTelegram.sendText.mockResolvedValue(undefined);

      await service.send(baseInput);

      expect(mockTelegram.sendText).toHaveBeenCalledTimes(1);
      expect(mockEmail.send).not.toHaveBeenCalled();
    });

    it('usa email (HTML) como fallback si no hay canal Telegram', async () => {
      mockTelegram.getChatId.mockResolvedValue(null);
      mockEmail.isRealEmail.mockReturnValue(true);
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'user@example.com' });
      mockEmail.sendHtml.mockResolvedValue(undefined);

      await service.send(baseInput);

      expect(mockTelegram.sendText).not.toHaveBeenCalled();
      expect(mockEmail.sendHtml).toHaveBeenCalledWith(
        'user@example.com',
        expect.stringContaining(baseInput.title),
        expect.any(String),
        expect.stringContaining(baseInput.title),
      );
    });

    it('omite email si el usuario tiene email sintético @appp.local', async () => {
      mockTelegram.getChatId.mockResolvedValue(null);
      mockEmail.isRealEmail.mockReturnValue(false);
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'telegram_123@appp.local' });

      await service.send(baseInput);

      expect(mockEmail.sendHtml).not.toHaveBeenCalled();
    });

    it('programa escalación cuando requiresAck=true y Telegram disponible', async () => {
      mockTelegram.getChatId.mockResolvedValue(55555);
      mockTelegram.sendText.mockResolvedValue(undefined);
      mockQueueService.escalation.add.mockResolvedValue(undefined);

      await service.send({ ...baseInput, requiresAck: true });

      expect(mockQueueService.escalation.add).toHaveBeenCalledWith(
        'escalation',
        expect.objectContaining({ notificationId: 'new-3', userId: 'user-1' }),
        expect.objectContaining({ delay: expect.any(Number) }),
      );
    });
  });

  describe('delivery logging', () => {
    it('registra entrega como SENT en NotificationDelivery al éxito', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      mockPrisma.notification.create.mockResolvedValue({ notificationId: 'new-4' });
      mockTelegram.getChatId.mockResolvedValue(77777);
      mockPrisma.notificationDelivery.create.mockResolvedValue({ deliveryId: BigInt(4) });
      mockTelegram.sendText.mockResolvedValue(undefined);
      mockPrisma.notificationDelivery.update.mockResolvedValue({});

      await service.send(baseInput);

      expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SENT' }),
        }),
      );
    });

    it('registra entrega como FAILED si Telegram lanza error', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      mockPrisma.notification.create.mockResolvedValue({ notificationId: 'new-5' });
      mockTelegram.getChatId.mockResolvedValue(88888);
      mockPrisma.notificationDelivery.create.mockResolvedValue({ deliveryId: BigInt(5) });
      mockTelegram.sendText.mockRejectedValue(new Error('Telegram error'));
      mockPrisma.notificationDelivery.update.mockResolvedValue({});

      await service.send(baseInput); // no debe lanzar

      expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });
  });
});
