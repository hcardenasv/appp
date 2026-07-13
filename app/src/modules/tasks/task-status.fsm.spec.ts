import {
  assertValidTransition,
  InvalidTransitionError,
  isValidTransition,
  TaskStatus,
} from './task-status.fsm';

describe('TaskStatus FSM', () => {
  const VALID: [TaskStatus, TaskStatus][] = [
    ['PENDING', 'IN_PROGRESS'],
    ['PENDING', 'DEFERRED'],
    ['PENDING', 'BLOCKED'],
    ['PENDING', 'CANCELLED'],
    ['IN_PROGRESS', 'DONE'],
    ['IN_PROGRESS', 'BLOCKED'],
    ['IN_PROGRESS', 'DEFERRED'],
    ['IN_PROGRESS', 'CANCELLED'],
    ['BLOCKED', 'IN_PROGRESS'],
    ['BLOCKED', 'CANCELLED'],
    ['DEFERRED', 'PENDING'],
    ['DEFERRED', 'CANCELLED'],
  ];

  const INVALID: [TaskStatus, TaskStatus][] = [
    ['DONE', 'PENDING'],
    ['DONE', 'IN_PROGRESS'],
    ['DONE', 'CANCELLED'],
    ['CANCELLED', 'PENDING'],
    ['CANCELLED', 'IN_PROGRESS'],
    ['DEFERRED', 'IN_PROGRESS'],
    ['BLOCKED', 'DONE'],
    ['PENDING', 'DONE'],
  ];

  describe('isValidTransition', () => {
    test.each(VALID)('%s → %s devuelve true', (from, to) => {
      expect(isValidTransition(from, to)).toBe(true);
    });

    test.each(INVALID)('%s → %s devuelve false', (from, to) => {
      expect(isValidTransition(from, to)).toBe(false);
    });

    it('devuelve false para estados desconocidos', () => {
      expect(isValidTransition('UNKNOWN' as TaskStatus, 'PENDING')).toBe(false);
    });
  });

  describe('assertValidTransition', () => {
    test.each(VALID)('%s → %s no lanza', (from, to) => {
      expect(() => assertValidTransition(from, to)).not.toThrow();
    });

    test.each(INVALID)('%s → %s lanza InvalidTransitionError', (from, to) => {
      expect(() => assertValidTransition(from, to)).toThrow(InvalidTransitionError);
    });

    it('el mensaje del error contiene los estados', () => {
      try {
        assertValidTransition('DONE', 'PENDING');
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidTransitionError);
        expect((e as InvalidTransitionError).message).toContain('DONE');
        expect((e as InvalidTransitionError).message).toContain('PENDING');
      }
    });
  });
});
