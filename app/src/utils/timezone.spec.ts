import { localDayRange, localDateAsUtcMidnight, workdayToCron } from './timezone';

describe('timezone utilities', () => {
  describe('workdayToCron', () => {
    it('genera cron para 08:30 lun-vie', () => {
      const time = new Date('1970-01-01T08:30:00Z');
      expect(workdayToCron(time, [1, 2, 3, 4, 5])).toBe('30 8 * * 1,2,3,4,5');
    });

    it('genera cron para 18:00 lun-vie', () => {
      const time = new Date('1970-01-01T18:00:00Z');
      expect(workdayToCron(time, [1, 2, 3, 4, 5])).toBe('0 18 * * 1,2,3,4,5');
    });

    it('genera cron con días personalizados', () => {
      const time = new Date('1970-01-01T09:00:00Z');
      expect(workdayToCron(time, [1, 3, 5])).toBe('0 9 * * 1,3,5');
    });
  });

  describe('localDateAsUtcMidnight', () => {
    it('devuelve medianoche UTC del día local', () => {
      const result = localDateAsUtcMidnight('America/Santiago');
      expect(result.getUTCHours()).toBe(0);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCSeconds()).toBe(0);
    });

    it('con dayOffset=1 devuelve mañana', () => {
      const today    = localDateAsUtcMidnight('America/Santiago', 0);
      const tomorrow = localDateAsUtcMidnight('America/Santiago', 1);
      const diff = tomorrow.getTime() - today.getTime();
      expect(diff).toBe(24 * 60 * 60 * 1000);
    });

    it('con dayOffset=-1 devuelve ayer', () => {
      const today     = localDateAsUtcMidnight('America/Santiago', 0);
      const yesterday = localDateAsUtcMidnight('America/Santiago', -1);
      const diff = today.getTime() - yesterday.getTime();
      expect(diff).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('localDayRange', () => {
    it('el rango cubre exactamente 24 horas', () => {
      const { gte, lt } = localDayRange('America/Santiago');
      const diff = lt.getTime() - gte.getTime();
      expect(diff).toBe(24 * 60 * 60 * 1000);
    });

    it('dayOffset=0 y dayOffset=1 son rangos adyacentes sin solapamiento', () => {
      const today    = localDayRange('America/Santiago', 0);
      const tomorrow = localDayRange('America/Santiago', 1);
      expect(today.lt.getTime()).toBe(tomorrow.gte.getTime());
    });

    it('dayOffset=-1 y dayOffset=0 son rangos adyacentes', () => {
      const yesterday = localDayRange('America/Santiago', -1);
      const today     = localDayRange('America/Santiago', 0);
      expect(yesterday.lt.getTime()).toBe(today.gte.getTime());
    });
  });
});
