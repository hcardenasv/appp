/**
 * Devuelve el rango UTC [gte, lt) que corresponde a `dayOffset` días desde
 * hoy en la timezone indicada.
 *
 * Nota: usa el offset actual de la TZ para calcular los límites. En zonas con
 * DST puede desviarse ≤1 hora en el momento exacto del cambio de hora. Para
 * un asistente personal esto es aceptable.
 */
export function localDayRange(
  timezone: string,
  dayOffset = 0,
): { gte: Date; lt: Date } {
  const now = new Date();

  // Fecha local en la TZ del usuario (formato ISO: "2026-07-14")
  const localDateStr = new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(now);
  const [y, m, d] = localDateStr.split('-').map(Number);

  // Aplicar offset de días
  const targetUtcDay = new Date(Date.UTC(y, m - 1, d + dayOffset));
  const targetDateStr = targetUtcDay.toISOString().slice(0, 10);

  // Offset del servidor → TZ del usuario en ms (positivo = TZ al oeste de UTC)
  const utcMs = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const localMs = new Date(now.toLocaleString('en-US', { timeZone: timezone })).getTime();
  const offsetMs = utcMs - localMs;

  const gte = new Date(new Date(`${targetDateStr}T00:00:00Z`).getTime() + offsetMs);
  const lt  = new Date(new Date(`${targetDateStr}T24:00:00Z`).getTime() + offsetMs);
  return { gte, lt };
}

/**
 * Devuelve un Date representando medianoche UTC del día local en la TZ dada.
 * Prisma lo almacena en columnas @db.Date como la fecha local correcta.
 */
export function localDateAsUtcMidnight(timezone: string, dayOffset = 0): Date {
  const localDateStr = new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(new Date());
  const [y, m, d] = localDateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dayOffset));
}

/**
 * Convierte workday_start (Date con parte horaria en UTC, parte fecha = época)
 * y la lista work_days (1=lun … 7=dom, ISO) a cron string compatible con BullMQ.
 */
export function workdayToCron(workdayTime: Date, workDays: number[]): string {
  const hours   = workdayTime.getUTCHours();
  const minutes = workdayTime.getUTCMinutes();
  const days    = workDays.join(',');
  return `${minutes} ${hours} * * ${days}`;
}
