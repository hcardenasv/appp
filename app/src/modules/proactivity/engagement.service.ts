import { Injectable } from '@nestjs/common';
import type { EngagementState } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ENGAGEMENT_STATES } from './proactivity.constants';

@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async getState(userId: string): Promise<EngagementState | null> {
    return this.prisma.engagementState.findUnique({ where: { userId } });
  }

  async transitionState(
    userId: string,
    newState: string,
    nudgeLevel = 0,
  ): Promise<void> {
    await this.prisma.engagementState.upsert({
      where: { userId },
      update: {
        currentState:  newState,
        nudgeLevel,
        stateChangedAt: new Date(),
      },
      create: {
        userId,
        currentState:  newState,
        nudgeLevel,
        stateChangedAt: new Date(),
      },
    });
  }

  async recordInteraction(userId: string, channelType: string): Promise<void> {
    await this.prisma.engagementState.upsert({
      where: { userId },
      update: {
        lastInteractionAt: new Date(),
        lastChannel: channelType,
        currentState: ENGAGEMENT_STATES.ENGAGED,
        nudgeLevel: 0,
        stateChangedAt: new Date(),
      },
      create: {
        userId,
        lastInteractionAt: new Date(),
        lastChannel: channelType,
        currentState: ENGAGEMENT_STATES.ENGAGED,
        nudgeLevel: 0,
        stateChangedAt: new Date(),
      },
    });
  }
}
