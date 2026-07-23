type ReminderOffset = { minutesBefore: number };

// Plantillas de recordatorios automáticos por tipo de tarea.
// Solo se generan si la tarea tiene due_at.
export const REMINDER_TEMPLATES: Record<string, ReminderOffset[]> = {
  MEETING:           [{ minutesBefore: 24 * 60 }, { minutesBefore: 60 }, { minutesBefore: 10 }],
  PHONE_CALL:        [{ minutesBefore: 60 }, { minutesBefore: 10 }],
  DEADLINE:          [{ minutesBefore: 3 * 24 * 60 }, { minutesBefore: 24 * 60 }, { minutesBefore: 4 * 60 }],
  REPORT:            [{ minutesBefore: 3 * 24 * 60 }, { minutesBefore: 24 * 60 }, { minutesBefore: 4 * 60 }],
  AGREEMENT:         [{ minutesBefore: 24 * 60 }, { minutesBefore: 4 * 60 }],
  PROJECT_MILESTONE: [{ minutesBefore: 3 * 24 * 60 }, { minutesBefore: 24 * 60 }],
  EMAIL_SEND:        [{ minutesBefore: 60 }, { minutesBefore: 10 }],
  REMINDER:          [{ minutesBefore: 0 }],   // dispara exactamente en dueAt
  GENERIC:           [{ minutesBefore: 60 }],
};
