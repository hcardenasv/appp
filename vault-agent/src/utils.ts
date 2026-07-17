/** Returns the local date string (YYYY-MM-DD) in a given timezone. */
export function localDateStr(timezone: string, offset = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(d);
}

/** Returns the previous day's date string. */
export function prevDateStr(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Formats a UTC Date as HH:MM in a given timezone. */
export function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  }).format(date);
}
