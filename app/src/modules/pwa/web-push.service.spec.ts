import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebPushService } from './web-push.service';
import { PrismaService } from '../../database/prisma.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

import * as webpush from 'web-push';

const mockPrisma = {
  pushSubscription: {
    findMany:    jest.fn(),
    update:      jest.fn(),
    deleteMany:  jest.fn(),
  },
};

const makeSub = (overrides = {}) => ({
  subId:    'sub-uuid-1',
  userId:   'user-1',
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  auth:     'auth-key',
  p256dh:   'p256dh-key',
  ...overrides,
});

describe('WebPushService', () => {
  let service: WebPushService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        WebPushService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'VAPID_PUBLIC_KEY')  return 'pub-key';
              if (key === 'VAPID_PRIVATE_KEY') return 'priv-key';
              if (key === 'VAPID_EMAIL')       return 'mailto:test@appp.local';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get(WebPushService);
  });

  it('llama a setVapidDetails en construcción cuando hay claves', () => {
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:test@appp.local', 'pub-key', 'priv-key',
    );
  });

  it('isConfigured() devuelve true con claves VAPID configuradas', () => {
    expect(service.isConfigured()).toBe(true);
  });

  it('getPublicKey() devuelve la clave pública', () => {
    expect(service.getPublicKey()).toBe('pub-key');
  });

  describe('sendToUser', () => {
    it('envía a todas las suscripciones del usuario', async () => {
      mockPrisma.pushSubscription.findMany.mockResolvedValue([makeSub()]);
      (webpush.sendNotification as jest.Mock).mockResolvedValue(undefined);
      mockPrisma.pushSubscription.update.mockResolvedValue({});

      await service.sendToUser('user-1', { title: 'Test', body: 'Hola' });

      expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { auth: 'auth-key', p256dh: 'p256dh-key' } },
        JSON.stringify({ title: 'Test', body: 'Hola' }),
        { TTL: 86400 },
      );
    });

    it('elimina suscripciones expiradas (410)', async () => {
      mockPrisma.pushSubscription.findMany.mockResolvedValue([
        makeSub({ subId: 'sub-1' }),
        makeSub({ subId: 'sub-2', endpoint: 'https://other.endpoint' }),
      ]);
      const expiredError = Object.assign(new Error('Gone'), { statusCode: 410 });
      (webpush.sendNotification as jest.Mock)
        .mockRejectedValueOnce(expiredError)
        .mockResolvedValueOnce(undefined);
      mockPrisma.pushSubscription.update.mockResolvedValue({});
      mockPrisma.pushSubscription.deleteMany.mockResolvedValue({});

      await service.sendToUser('user-1', { title: 'Test', body: '' });

      expect(mockPrisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { subId: { in: ['sub-1'] } },
      });
    });

    it('elimina suscripciones expiradas (404)', async () => {
      mockPrisma.pushSubscription.findMany.mockResolvedValue([makeSub({ subId: 'gone' })]);
      const err = Object.assign(new Error('Not Found'), { statusCode: 404 });
      (webpush.sendNotification as jest.Mock).mockRejectedValue(err);
      mockPrisma.pushSubscription.deleteMany.mockResolvedValue({});

      await service.sendToUser('user-1', { title: 'T', body: 'B' });

      expect(mockPrisma.pushSubscription.deleteMany).toHaveBeenCalled();
    });

    it('no envía nada si el usuario no tiene suscripciones', async () => {
      mockPrisma.pushSubscription.findMany.mockResolvedValue([]);

      await service.sendToUser('user-1', { title: 'T', body: 'B' });

      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('no envía si no está configurado', async () => {
      const module = await Test.createTestingModule({
        providers: [
          WebPushService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: { get: () => undefined } },
        ],
      }).compile();

      const unconfigured = module.get(WebPushService);
      await unconfigured.sendToUser('user-1', { title: 'T', body: 'B' });

      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });
  });
});
