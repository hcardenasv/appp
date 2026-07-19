const BASE_STYLE = `
  body{margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .wrap{max-width:600px;margin:0 auto;background:#ffffff}
  .hdr{background:#1a1a2e;padding:20px 28px}
  .hdr h1{margin:0;color:#ffffff;font-size:16px;font-weight:600;letter-spacing:.5px}
  .body{padding:28px;color:#222222;line-height:1.65;font-size:15px}
  .title{font-size:20px;font-weight:700;color:#1a1a2e;margin-bottom:12px}
  .section{margin-top:20px;padding-top:16px;border-top:1px solid #eeeeee}
  .ftr{background:#f4f4f5;padding:14px 28px;text-align:center;font-size:12px;color:#888888}
  pre{background:#f8f8f8;padding:12px;border-radius:4px;font-size:13px;white-space:pre-wrap;word-break:break-word}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eeeeee;font-size:14px}
  th{color:#555555;font-weight:600}
`.trim();

function htmlShell(body: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLE}</style></head><body><div class="wrap">${body}<div class="ftr">APPP — Asistente Personal Proactivo de Productividad</div></div></body></html>`;
}

const HDR = `<div class="hdr"><h1>🤖 APPP</h1></div>`;

// ── Reminder ──────────────────────────────────────────────────────────────────

export function buildReminderEmail(title: string, body: string): { subject: string; html: string; text: string } {
  const subject = `🔔 Recordatorio: ${title}`;
  const html = htmlShell(`
    ${HDR}
    <div class="body">
      <div class="title">${escapeHtml(title)}</div>
      <p>${escapeHtml(body)}</p>
    </div>
  `);
  const text = `${title}\n\n${body}`;
  return { subject, html, text };
}

// ── Escalation ────────────────────────────────────────────────────────────────

export function buildEscalationEmail(title: string, body: string): { subject: string; html: string; text: string } {
  const subject = `⚠️ Notificación pendiente: ${title}`;
  const html = htmlShell(`
    ${HDR}
    <div class="body">
      <div class="title">⚠️ Tienes una notificación pendiente</div>
      <p>No registramos actividad reciente en Telegram. Te enviamos este email para que no te pierdas nada importante.</p>
      <div class="section">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(body)}</p>
      </div>
    </div>
  `);
  const text = `Notificación pendiente: ${title}\n\n${body}\n\n(Abre Telegram para responder)`;
  return { subject, html, text };
}

// ── Daily report ──────────────────────────────────────────────────────────────

export function buildDailyReportEmail(
  displayName: string,
  date: string,
  planned: number,
  done: number,
  deferred: number,
  cancelled: number,
  streak: number,
): { subject: string; html: string; text: string } {
  const name = displayName.split(' ')[0];
  const rate = planned > 0 ? Math.round(done / planned * 100) : 0;
  const subject = `📊 Reporte diario APPP — ${date}`;

  const rows = [
    ['📋 Planificadas', String(planned)],
    [`✅ Completadas`, `${done} (${rate}%)`],
    ...(deferred  > 0 ? [['⏭ Postergadas', String(deferred)]] as const  : []),
    ...(cancelled > 0 ? [['❌ Canceladas',  String(cancelled)]] as const : []),
    ...(streak    > 0 ? [['🔥 Racha',       `${streak} día${streak === 1 ? '' : 's'}`]] as const : []),
  ];

  const tableHtml = `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;

  const html = htmlShell(`
    ${HDR}
    <div class="body">
      <div class="title">Reporte diario — ${escapeHtml(date)}</div>
      <p>Hola ${escapeHtml(name)}, aquí está el resumen de tu día.</p>
      <div class="section">${tableHtml}</div>
    </div>
  `);

  const text = [
    `Reporte diario APPP — ${date}`,
    `Hola ${name}!`,
    `Completadas: ${done} de ${planned} (${rate}%)`,
    deferred  > 0 ? `Postergadas: ${deferred}` : '',
    cancelled > 0 ? `Canceladas: ${cancelled}` : '',
    streak    > 0 ? `Racha: ${streak} días 🔥` : '',
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

// ── Period report (weekly / monthly) ─────────────────────────────────────────

export function buildPeriodReportEmail(
  displayName: string,
  periodType: 'WEEKLY' | 'MONTHLY',
  label: string,
  planned: number,
  done: number,
  completionRate: number,
  streak: number,
): { subject: string; html: string; text: string } {
  const name     = displayName.split(' ')[0];
  const typeName = periodType === 'WEEKLY' ? 'semanal' : 'mensual';
  const subject  = `📊 Resumen ${typeName} APPP — ${label}`;

  const rows = [
    ['📋 Planificadas', String(planned)],
    [`✅ Completadas`, `${done} (${completionRate}%)`],
    ...(streak > 0 ? [['🔥 Racha', `${streak} día${streak === 1 ? '' : 's'}`]] as const : []),
  ];

  const tableHtml = `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;

  const html = htmlShell(`
    ${HDR}
    <div class="body">
      <div class="title">Resumen ${typeName} — ${escapeHtml(label)}</div>
      <p>Hola ${escapeHtml(name)}, aquí está tu resumen ${typeName}.</p>
      <div class="section">${tableHtml}</div>
    </div>
  `);

  const text = `Resumen ${typeName} APPP — ${label}\n\nHola ${name}!\nCompletadas: ${done} de ${planned} (${completionRate}%)${streak > 0 ? `\nRacha: ${streak} días 🔥` : ''}`;

  return { subject, html, text };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
