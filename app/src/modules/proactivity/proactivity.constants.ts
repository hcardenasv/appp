export const QUEUES = {
  CHECKIN:         'checkin',
  CHECKOUT:        'checkout',
  INACTIVITY_SCAN: 'inactivity-scan',
  REMINDERS:       'reminders',
  DAILY_REPORT:    'daily-report',
  PERIOD_REPORT:   'period-report',
  ESCALATION:      'escalation',
} as const;

export const JOB_NAMES = {
  CHECKIN:         'checkin',
  CHECKOUT:        'checkout',
  INACTIVITY_SCAN: 'inactivity-scan',
  DAILY_REPORT:    'daily-report',
  PERIOD_REPORT:   'period-report',
  ESCALATION:      'escalation',
} as const;

export const ENGAGEMENT_STATES = {
  IDLE:              'IDLE',
  AWAITING_CHECKIN:  'AWAITING_CHECKIN',
  AWAITING_CHECKOUT: 'AWAITING_CHECKOUT',
  ENGAGED:           'ENGAGED',
  NUDGING:           'NUDGING',
  ESCALATING:        'ESCALATING',
  DORMANT:           'DORMANT',
} as const;

// Minutos sin respuesta para avanzar al siguiente nivel de nudge
export const NUDGE_THRESHOLDS_MIN = {
  FIRST:   15,  // AWAITING → NUDGING (nivel 1)
  SECOND:  45,  // NUDGING  → ESCALATING (nivel 2 — Telegram + email en Hito 6)
  DORMANT: 480, // 8 h sin respuesta → DORMANT + sesión MISSED
} as const;

// Cron global del inactivity scan (cada 15 min)
export const INACTIVITY_SCAN_CRON = '*/15 * * * *';
