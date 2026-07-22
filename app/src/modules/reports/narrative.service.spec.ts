import Anthropic from '@anthropic-ai/sdk';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NarrativeService } from './narrative.service';

jest.mock('@anthropic-ai/sdk');
const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

const weeklyParams = {
  label: '14–20 jul', planned: 10, done: 8, completionRate: 80,
  deferred: 1, cancelled: 1, bestDay: 'martes', prevWeekRate: 60, streak: 5,
};

const monthlyParams = {
  label: 'julio 2026', planned: 40, done: 30, completionRate: 75,
  deferred: 6, cancelled: 4, adherenceRate: 90, bestStreak: 10,
};

const makeModule = (apiKey: string | undefined) =>
  Test.createTestingModule({
    providers: [
      NarrativeService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => {
            if (key === 'ANTHROPIC_API_KEY')       return apiKey;
            if (key === 'ANTHROPIC_MODEL_PLANNING') return 'claude-test';
            return undefined;
          },
        },
      },
    ],
  })
    .compile()
    .then(m => m.get(NarrativeService));

describe('NarrativeService', () => {
  let service: NarrativeService;
  let mockCreate: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCreate = jest.fn();
    MockAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic);

    service = await makeModule('api-key-test');
  });

  it('isEnabled() es true cuando hay API key', () => {
    expect(service.isEnabled()).toBe(true);
  });

  it('isEnabled() es false cuando no hay API key', async () => {
    const s = await makeModule(undefined);
    expect(s.isEnabled()).toBe(false);
  });

  describe('weeklyNarrative', () => {
    it('llama a Claude con el prompt de métricas semanales y devuelve el texto', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '  Buena semana.  ' }],
      });

      const result = await service.weeklyNarrative(weeklyParams);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 200,
          messages:   expect.arrayContaining([
            expect.objectContaining({
              role:    'user',
              content: expect.stringContaining('Semana 14–20 jul'),
            }),
          ]),
        }),
      );
      expect(result).toBe('Buena semana.');
    });

    it('devuelve null si no hay API key configurada', async () => {
      const s = await makeModule(undefined);
      const result = await s.weeklyNarrative(weeklyParams);
      expect(result).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('devuelve null y no lanza si Claude falla', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));
      const result = await service.weeklyNarrative(weeklyParams);
      expect(result).toBeNull();
    });

    it('incluye métricas clave en el prompt', async () => {
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      await service.weeklyNarrative(weeklyParams);

      const call = mockCreate.mock.calls[0][0];
      const userContent = call.messages[0].content as string;
      expect(userContent).toContain('80%');
      expect(userContent).toContain('martes');
      expect(userContent).toContain('60%');
      expect(userContent).toContain('5 días');
    });
  });

  describe('monthlyNarrative', () => {
    it('llama a Claude con el prompt de métricas mensuales', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Mes productivo.' }],
      });

      const result = await service.monthlyNarrative(monthlyParams);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role:    'user',
              content: expect.stringContaining('julio 2026'),
            }),
          ]),
        }),
      );
      expect(result).toBe('Mes productivo.');
    });

    it('incluye adherencia y mejor racha en el prompt', async () => {
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      await service.monthlyNarrative(monthlyParams);

      const call = mockCreate.mock.calls[0][0];
      const userContent = call.messages[0].content as string;
      expect(userContent).toContain('90%');
      expect(userContent).toContain('10 días');
    });

    it('devuelve null si no hay API key', async () => {
      const s = await makeModule(undefined);
      expect(await s.monthlyNarrative(monthlyParams)).toBeNull();
    });

    it('devuelve null y no lanza si Claude falla', async () => {
      mockCreate.mockRejectedValue(new Error('timeout'));
      expect(await service.monthlyNarrative(monthlyParams)).toBeNull();
    });
  });
});
