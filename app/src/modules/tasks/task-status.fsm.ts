export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'DONE'
  | 'CANCELLED'
  | 'DEFERRED';

const VALID_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  PENDING:     ['IN_PROGRESS', 'DEFERRED', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'BLOCKED', 'DEFERRED', 'CANCELLED'],
  BLOCKED:     ['IN_PROGRESS', 'CANCELLED'],
  DEFERRED:    ['PENDING', 'CANCELLED'],
  DONE:        [],
  CANCELLED:   [],
};

export class InvalidTransitionError extends Error {
  constructor(from: TaskStatus, to: string) {
    const allowed = VALID_TRANSITIONS[from].join(', ') || 'ninguno';
    super(`Transición inválida: ${from} → ${to}. Permitidas: [${allowed}]`);
    this.name = 'InvalidTransitionError';
  }
}

export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from as TaskStatus];
  return allowed !== undefined && (allowed as readonly string[]).includes(to);
}

export function assertValidTransition(from: string, to: string): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(from as TaskStatus, to);
  }
}
