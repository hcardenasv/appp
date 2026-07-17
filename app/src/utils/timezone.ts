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

/**
 * Retorna el cron string para un offset de minutos sobre workday_end,
 * restringido a los días indicados en notación cron (e.g. '* * 5' para viernes).
 */
export function afterWorkdayCron(workdayEnd: Date, cronDaySuffix: string, offsetMin = 60): string {
  const total = workdayEnd.getUTCHours() * 60 + workdayEnd.getUTCMinutes() + offsetMin;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${m} ${h} ${cronDaySuffix}`;
}

/** Rango de la semana ISO (lun–dom) en la TZ del usuario. weekOffset=-1 = semana anterior. */
export function localWeekBounds(timezone: string, weekOffset = 0): {
  gte: Date; lt: Date;          // Para columnas TIMESTAMPTZ (completedAt)
  dateGte: Date; dateLt: Date;  // Para columnas DATE (scheduledFor)
  label: string;                // "14–20 jul"
} {
  const now = new Date();
  const localStr = new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(now);
  const [y, m, d] = localStr.split('-').map(Number);

  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const mondayUTC = new Date(Date.UTC(y, m - 1, d - daysSinceMonday + weekOffset * 7));
  const nextMondayUTC = new Date(mondayUTC.getTime() + 7 * 86_400_000);

  const utcMs   = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const localMs = new Date(now.toLocaleString('en-US', { timeZone: timezone })).getTime();
  const offsetMs = utcMs - localMs;

  const sunUTC = new Date(nextMondayUTC.getTime() - 86_400_000);
  const fmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: timezone });
  const label = `${fmt.format(mondayUTC)}–${fmt.format(sunUTC)}`;

  return {
    gte:     new Date(mondayUTC.getTime() + offsetMs),
    lt:      new Date(nextMondayUTC.getTime() + offsetMs),
    dateGte: mondayUTC,
    dateLt:  nextMondayUTC,
    label,
  };
}

/** Rango del mes en la TZ del usuario. monthOffset=-1 = mes anterior. */
export function localMonthBounds(timezone: string, monthOffset = 0): {
  gte: Date; lt: Date;
  dateGte: Date; dateLt: Date;
  label: string;  // "julio 2026"
} {
  const now = new Date();
  const localStr = new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(now);
  const [y, m] = localStr.split('-').map(Number);

  const monthStart = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
  const nextMonth  = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));

  const utcMs   = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const localMs = new Date(now.toLocaleString('en-US', { timeZone: timezone })).getTime();
  const offsetMs = utcMs - localMs;

  const label = new Intl.DateTimeFormat('es-CL', {
    month: 'long', year: 'numeric', timeZone: timezone,
  }).format(monthStart);

  return {
    gte:     new Date(monthStart.getTime() + offsetMs),
    lt:      new Date(nextMonth.getTime() + offsetMs),
    dateGte: monthStart,
    dateLt:  nextMonth,
    label,
  };
}
