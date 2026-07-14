export const REMINDER_JOB_FIRE = 'fire-reminder';

/** Ventana de dedup para recordatorios (jobId único por reminder). */
export const REMINDER_DEDUP_PREFIX = 'reminder';

/** Máximo de notificaciones enviadas por usuario en una hora (fusible anti-spam). */
export const MAX_NOTIFICATIONS_PER_HOUR = 20;

/** Delay en ms antes de escalar un requiresAck no respondido → email. */
export const ESCALATION_DELAY_MS = 30 * 60 * 1_000;

/** Ventana de reconciliación de reminders futuros al arrancar (en ms). */
export const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
