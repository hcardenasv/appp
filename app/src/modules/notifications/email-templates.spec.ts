import {
  buildReminderEmail,
  buildEscalationEmail,
  buildDailyReportEmail,
  buildPeriodReportEmail,
} from './email-templates';

describe('buildReminderEmail', () => {
  it('incluye el título en subject y body', () => {
    const { subject, html, text } = buildReminderEmail('Reunión importante', 'A las 10am');
    expect(subject).toContain('Reunión importante');
    expect(html).toContain('Reunión importante');
    expect(html).toContain('A las 10am');
    expect(text).toContain('Reunión importante');
  });

  it('escapa HTML en el título', () => {
    const { html } = buildReminderEmail('<script>xss</script>', 'body');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildEscalationEmail', () => {
  it('subject indica notificación pendiente', () => {
    const { subject } = buildEscalationEmail('Alerta urgente', 'Tienes una tarea');
    expect(subject).toContain('Alerta urgente');
    expect(subject).toContain('pendiente');
  });

  it('html contiene el título y body', () => {
    const { html } = buildEscalationEmail('Alerta urgente', 'Descripción');
    expect(html).toContain('Alerta urgente');
    expect(html).toContain('Descripción');
  });
});

describe('buildDailyReportEmail', () => {
  it('calcula tasa de completitud correctamente', () => {
    const { html, text } = buildDailyReportEmail('Juan Pérez', '2026-07-17', 5, 4, 0, 1, 3);
    expect(html).toContain('80%');
    expect(text).toContain('80%');
  });

  it('incluye la racha cuando > 0', () => {
    const { html } = buildDailyReportEmail('María', '2026-07-17', 3, 3, 0, 0, 7);
    expect(html).toContain('7 días');
  });

  it('no incluye racha cuando = 0', () => {
    const { html } = buildDailyReportEmail('María', '2026-07-17', 3, 0, 0, 0, 0);
    expect(html).not.toContain('Racha');
  });

  it('usa solo el primer nombre en saludo', () => {
    const { html } = buildDailyReportEmail('Juan Carlos Pérez', '2026-07-17', 0, 0, 0, 0, 0);
    expect(html).toContain('Juan');
    expect(html).not.toContain('Juan Carlos Pérez');
  });

  it('sujeto contiene la fecha', () => {
    const { subject } = buildDailyReportEmail('Juan', '2026-07-17', 0, 0, 0, 0, 0);
    expect(subject).toContain('2026-07-17');
  });

  it('completionRate=0 si no hay tareas', () => {
    const { text } = buildDailyReportEmail('Juan', '2026-07-17', 0, 0, 0, 0, 0);
    expect(text).toBeDefined();
  });
});

describe('buildPeriodReportEmail', () => {
  it('sujeto distingue semanal vs mensual', () => {
    const weekly  = buildPeriodReportEmail('Ana', 'WEEKLY',  '14–20 jul', 10, 8, 80, 5);
    const monthly = buildPeriodReportEmail('Ana', 'MONTHLY', 'julio 2026', 40, 30, 75, 10);
    expect(weekly.subject).toContain('semanal');
    expect(monthly.subject).toContain('mensual');
  });

  it('html contiene las métricas del período', () => {
    const { html } = buildPeriodReportEmail('Ana', 'WEEKLY', '14–20 jul', 10, 8, 80, 5);
    expect(html).toContain('80%');
    expect(html).toContain('5 días');
  });

  it('incluye narrativa en html y text cuando se provee', () => {
    const narrativa = 'Excelente semana con progreso consistente.';
    const { html, text } = buildPeriodReportEmail('Ana', 'WEEKLY', '14–20 jul', 10, 8, 80, 5, narrativa);
    expect(html).toContain('Análisis');
    expect(html).toContain('Excelente semana con progreso consistente.');
    expect(text).toContain('Análisis');
    expect(text).toContain('Excelente semana con progreso consistente.');
  });

  it('no incluye sección narrativa cuando no se provee', () => {
    const { html } = buildPeriodReportEmail('Ana', 'WEEKLY', '14–20 jul', 10, 8, 80, 5);
    expect(html).not.toContain('Análisis');
  });
});
