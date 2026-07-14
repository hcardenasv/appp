import { Test, TestingModule } from '@nestjs/testing';
import { EngagementService } from './engagement.service';
import { PrismaService } from '../../database/prisma.service';
import { ENGAGEMENT_STATES } from './proactivity.constants';

const makeState = (overrides = {}) => ({
  userId: 'uuid-user-1',
  lastInteractionAt: null,
  lastChannel: null,
  currentState: ENGAGEMENT_STATES.IDLE,
  nudgeLevel: 0,
  stateChangedAt: new Date('2026-07-14T08:00:00Z'),
  ...overrides,
});

describe('EngagementService', () => {
  let service: EngagementService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      engagementState: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EngagementService>(EngagementService);
    prisma  = module.get(PrismaService);
  });

  describe('getState', () => {
    it('retorna null cuando no existe estado', async () => {
      (prisma.engagementState.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await service.getState('uuid-user-1')).toBeNull();
    });

    it('retorna el estado cuando existe', async () => {
      const state = makeState();
      (prisma.engagementState.findUnique as jest.Mock).mockResolvedValue(state);
      expect(await service.getState('uuid-user-1')).toEqual(state);
    });
  });

  describe('transitionState', () => {
    it('hace upsert con el nuevo estado y nudgeLevel', async () => {
      (prisma.engagementState.upsert as jest.Mock).mockResolvedValue(makeState());
      await service.transitionState('uuid-user-1', ENGAGEMENT_STATES.AWAITING_CHECKIN, 0);

      expect(prisma.engagementState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            currentState: ENGAGEMENT_STATES.AWAITING_CHECKIN,
            nudgeLevel: 0,
          }),
        }),
      );
    });

    it('actualiza el nudgeLevel correctamente', async () => {
      (prisma.engagementState.upsert as jest.Mock).mockResolvedValue(makeState());
      await service.transitionState('uuid-user-1', ENGAGEMENT_STATES.NUDGING, 1);

      expect(prisma.engagementState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ nudgeLevel: 1 }),
        }),
      );
    });
  });

  describe('recordInteraction', () => {
    it('setea estado ENGAGED, nudgeLevel 0 y lastInteractionAt', async () => {
      (prisma.engagementState.upsert as jest.Mock).mockResolvedValue(makeState());
      await service.recordInteraction('uuid-user-1', 'TELEGRAM');

      expect(prisma.engagementState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            currentState: ENGAGEMENT_STATES.ENGAGED,
            nudgeLevel: 0,
            lastChannel: 'TELEGRAM',
          }),
        }),
      );
    });
  });
});
