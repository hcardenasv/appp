import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface WeeklyNarrativeParams {
  label:         string;
  planned:       number;
  done:          number;
  completionRate: number;
  deferred:      number;
  cancelled:     number;
  bestDay:       string | null;
  prevWeekRate:  number;
  streak:        number;
}

export interface MonthlyNarrativeParams {
  label:          string;
  planned:        number;
  done:           number;
  completionRate: number;
  deferred:       number;
  cancelled:      number;
  adherenceRate:  number;
  bestStreak:     number;
}

const SYSTEM_PROMPT =
  'Eres el asistente de productividad APPP. Tu función es escribir una narrativa ejecutiva breve ' +
  '(2–3 oraciones) sobre el rendimiento del usuario en el período indicado. Sé específico con los ' +
  'números. Usa un tono directo, constructivo y motivador. No uses markdown, listas ni emojis. ' +
  'Responde solo en español.';

const MAX_TOKENS = 200;

@Injectable()
export class NarrativeService {
  private readonly logger = new Logger(NarrativeService.name);
  private readonly anthropic: Anthropic | null;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.anthropic = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = config.get<string>('ANTHROPIC_MODEL_PLANNING') ?? 'claude-sonnet-4-6';
  }

  isEnabled(): boolean {
    return this.anthropic !== null;
  }

  async weeklyNarrative(p: WeeklyNarrativeParams): Promise<string | null> {
    const content =
      `Semana ${p.label}:\n` +
      `- Tareas planificadas: ${p.planned}\n` +
      `- Completadas: ${p.done} (${p.completionRate}%)\n` +
      `- Postergadas: ${p.deferred}\n` +
      `- Canceladas: ${p.cancelled}\n` +
      `- Mejor día: ${p.bestDay ?? 'sin datos'}\n` +
      `- Semana anterior: ${p.prevWeekRate}%\n` +
      `- Racha de hábito actual: ${p.streak} días`;

    return this.callClaude(content);
  }

  async monthlyNarrative(p: MonthlyNarrativeParams): Promise<string | null> {
    const content =
      `Mes ${p.label}:\n` +
      `- Tareas planificadas: ${p.planned}\n` +
      `- Completadas: ${p.done} (${p.completionRate}%)\n` +
      `- Postergadas: ${p.deferred}\n` +
      `- Canceladas: ${p.cancelled}\n` +
      `- Adherencia al ritual (check-in/check-out): ${p.adherenceRate}%\n` +
      `- Mejor racha del mes: ${p.bestStreak} días`;

    return this.callClaude(content);
  }

  private async callClaude(userContent: string): Promise<string | null> {
    if (!this.anthropic) return null;

    try {
      const response = await this.anthropic.messages.create({
        model:      this.model,
        max_tokens: MAX_TOKENS,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userContent }],
      });

      const block = response.content.find(b => b.type === 'text');
      return block?.type === 'text' ? block.text.trim() : null;
    } catch (err) {
      this.logger.error('Error generando narrativa con Claude', err);
      return null;
    }
  }
}
