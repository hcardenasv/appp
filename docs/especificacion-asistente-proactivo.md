# Especificación Funcional y Técnica
## Asistente Personal Proactivo de Productividad (APPP)

**Versión:** 1.0 — Borrador para revisión
**Rol del documento:** Especificación funcional y técnica de alto nivel para diseño y desarrollo
**Audiencia:** Equipo de arquitectura, desarrollo backend/frontend, DBA, DevOps

---

## 0. Resumen Ejecutivo

El APPP es un sistema de gestión personal de tareas cuyo diferenciador central es la **inversión del modelo de interacción**: en lugar de esperar que el usuario consulte su lista de pendientes (modelo pasivo, causa raíz del abandono), el sistema **toma la iniciativa** mediante un Motor de Proactividad que rige dos rituales diarios obligatorios (check-in matutino y check-out vespertino), escala notificaciones por múltiples canales (popup, email, Telegram) y detecta inactividad del usuario para reenganchar.

El principio de diseño rector es: **"El sistema persigue al usuario, no al revés."**

---

## 1. Alcance Funcional

### 1.1 Requerimientos Funcionales (RF)

| ID | Requerimiento | Prioridad |
|----|---------------|-----------|
| RF-01 | Interacción bimodal: voz (STT/TTS) y texto | Alta |
| RF-02 | Notificaciones vía popup nativo (OS/navegador) | Alta |
| RF-03 | Notificaciones vía correo electrónico automatizado | Alta |
| RF-04 | Notificaciones vía Bot de Telegram (bidireccional) | Alta |
| RF-05 | Gestión de tareas tipificadas: emails pendientes, informes, llamadas, reuniones, deadlines, acuerdos, avances de proyecto | Alta |
| RF-06 | Check-in matutino proactivo (resumen de pendientes + planificación del día) | Crítica |
| RF-07 | Check-out vespertino proactivo (revisión de avance real + replanificación) | Crítica |
| RF-08 | Detección de inactividad y escalamiento de recordatorios | Crítica |
| RF-09 | Cálculo automático de métricas de productividad | Alta |
| RF-10 | Reportes "Pendientes vs. Realizados" diarios, semanales y mensuales | Alta |
| RF-11 | Seguimiento multi-proyecto (múltiples flujos de trabajo en paralelo) | Media |
| RF-12 | Registro auditable de toda interacción (logs) | Media |

### 1.2 Requerimientos No Funcionales (RNF)

| ID | Requerimiento |
|----|---------------|
| RNF-01 | Disponibilidad del motor de scheduling ≥ 99.5% (el valor del producto muere si el sistema "olvida" notificar) |
| RNF-02 | Latencia de respuesta conversacional < 2 s (texto), < 4 s (voz end-to-end) |
| RNF-03 | Entrega de notificaciones con reintentos y confirmación de entrega (at-least-once con deduplicación) |
| RNF-04 | Persistencia transaccional del estado de tareas (ACID) |
| RNF-05 | Zona horaria configurable por usuario; todo el scheduling opera en TZ del usuario |
| RNF-06 | Cifrado en tránsito (TLS 1.2+) y en reposo; tokens de canales en vault/secret manager |
| RNF-07 | Diseño idempotente de jobs: un job re-ejecutado no duplica notificaciones |

---

## 2. Arquitectura de Alto Nivel

### 2.1 Estilo Arquitectónico

**Monolito modular orientado a eventos** (para v1), con separación estricta en módulos desplegables que permiten evolucionar a microservicios si escala a multi-tenant. Para un producto de esta naturaleza, un monolito modular reduce complejidad operacional sin sacrificar el desacoplamiento lógico; el componente que sí debe estar aislado desde el día uno es el **Scheduler/Motor de Proactividad**, porque su ciclo de vida y garantías de ejecución son distintos a los del API conversacional.

### 2.2 Diagrama Lógico (componentes)

```
┌──────────────────────────── CLIENTES ────────────────────────────┐
│  PWA / App Escritorio (popups nativos,   Telegram App   Email    │
│  Web Push, micrófono para voz)            (bot)          client  │
└───────────────┬──────────────────────────────┬──────────────┬────┘
                │ HTTPS/WSS                    │ Webhook      │ SMTP
┌───────────────▼──────────────────────────────▼──────────────▼────┐
│                        API GATEWAY / BFF                          │
│              (REST + WebSocket, autenticación JWT)                │
└───────┬───────────────┬───────────────┬───────────────┬──────────┘
        │               │               │               │
┌───────▼──────┐ ┌──────▼───────┐ ┌─────▼────────┐ ┌────▼─────────┐
│  Módulo      │ │  Módulo      │ │  Motor de    │ │  Módulo      │
│  Conversa-   │ │  Gestión de  │ │  Proactividad│ │  Analítica y │
│  cional      │ │  Tareas y    │ │  (Scheduler +│ │  Reportes    │
│  (NLU/LLM,   │ │  Eventos     │ │  Máquina de  │ │  (agregación,│
│  STT/TTS)    │ │  (CRUD, FSM  │ │  Estados de  │ │  batch jobs) │
│              │ │  de estados) │ │  Engagement) │ │              │
└───────┬──────┘ └──────┬───────┘ └─────┬────────┘ └────┬─────────┘
        │               │               │               │
        └───────────────┴───────┬───────┴───────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   BUS DE EVENTOS /      │
                    │   COLA DE TRABAJOS      │
                    │   (Redis + BullMQ o     │
                    │    RabbitMQ)            │
                    └───────────┬────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │      SERVICIO DE NOTIFICACIONES     │
              │  (orquestador omnicanal + política  │
              │   de escalamiento y reintentos)     │
              ├─────────┬───────────┬───────────────┤
              │ Adaptador│ Adaptador │ Adaptador     │
              │ Web Push │ Email     │ Telegram      │
              │ (VAPID)  │ (SMTP/API)│ (Bot API)     │
              └─────────┴───────────┴───────────────┘

  PERSISTENCIA:
  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐
  │ PostgreSQL   │  │ Redis        │  │ Object Storage    │
  │ (estado,     │  │ (colas, caché│  │ (audios de voz,   │
  │  modelo core,│  │  sesiones,   │  │  reportes PDF,    │
  │  logs, TSDB  │  │  locks de    │  │  adjuntos)        │
  │  vía particio│  │  scheduler)  │  │  (S3/MinIO)       │
  │  nes)        │  │              │  │                   │
  └──────────────┘  └──────────────┘  └───────────────────┘
```

### 2.3 Stack Tecnológico Sugerido

| Capa | Tecnología recomendada | Alternativa | Justificación |
|------|------------------------|-------------|---------------|
| Backend | **Node.js + NestJS (TypeScript)** | Python + FastAPI | Ecosistema maduro para WebSockets, BullMQ nativo, tipado fuerte, excelente para I/O intensivo (notificaciones) |
| Base de datos principal | **PostgreSQL 16** | — | Ver justificación detallada en §2.4 |
| Colas / Scheduler distribuido | **Redis 7 + BullMQ** | RabbitMQ + Celery (si stack Python) | Jobs con delay, repetibles (cron), reintentos exponenciales, locks distribuidos |
| Frontend | **PWA (React/Next.js)** + wrapper **Tauri o Electron** para escritorio | — | PWA habilita Web Push; el wrapper de escritorio habilita popups nativos del OS y arranque con el sistema |
| Notificaciones push navegador | **Web Push API + VAPID** (librería `web-push`) | — | Estándar, sin dependencia de vendor |
| Popups nativos escritorio | **Notification API del OS vía Tauri/Electron** | node-notifier | Notificaciones persistentes incluso con app minimizada |
| Email | **API transaccional: Amazon SES / SendGrid / Postmark** | SMTP propio (Nodemailer) | Entregabilidad, webhooks de bounce/apertura, plantillas |
| Telegram | **Telegram Bot API** (long polling en dev, **webhook** en prod) con `grammY` o `telegraf` | — | Canal bidireccional gratuito, ideal para check-in/check-out conversacional móvil |
| STT (voz→texto) | **Whisper (API u on-premise)** | Web Speech API (navegador), Google STT | Precisión alta en español; opción self-hosted para privacidad |
| TTS (texto→voz) | **API de TTS neural (OpenAI/Google/Azure)** o **Piper (self-hosted)** | Web Speech Synthesis | Voz natural; Piper si se requiere operación local |
| NLU / Conversación | **LLM vía API (Claude API)** con function calling para mapear intenciones a acciones del sistema | Rasa (determinista) | El LLM interpreta "recuérdame llamar a Pérez el jueves" → `create_task(type=CALL, due=...)` |
| Generación de reportes | Job batch + plantillas HTML → PDF (Puppeteer/WeasyPrint) | — | Reportes descargables y enviables por email |
| Observabilidad | Prometheus + Grafana; logs estructurados (Loki/ELK) | — | Crítico monitorear el scheduler: un cron caído = producto muerto |
| Secretos | Vault / AWS Secrets Manager | Variables de entorno cifradas | Tokens de bot, claves VAPID, API keys |

### 2.4 Justificación de la Base de Datos

**PostgreSQL como única base de datos de estado**, complementada con Redis como infraestructura efímera (no fuente de verdad):

1. **Estado de tareas = dominio transaccional relacional.** Las transiciones de estado (pendiente → en progreso → completada/pospuesta) exigen ACID; una tarea "perdida" por eventual consistency destruye la confianza en el producto.
2. **Modelo naturalmente relacional:** Usuario 1:N Proyectos 1:N Tareas 1:N Recordatorios/Notificaciones. Las consultas de negocio ("pendientes vs. realizados por semana por proyecto") son SQL agregado clásico.
3. **JSONB** cubre los casos semi-estructurados (payload de cada tipo de tarea, transcripciones, contexto conversacional) sin necesidad de una base documental adicional.
4. **Particionamiento por rango de fecha** en `interaction_logs` y `notifications` resuelve el crecimiento de series temporales sin introducir una TSDB dedicada en v1 (TimescaleDB como extensión si la analítica escala).
5. **`pg_cron` NO se usa para la proactividad de negocio** (ver §5): el scheduling vive en la capa de aplicación (BullMQ) para tener reintentos, observabilidad y lógica de escalamiento. PostgreSQL guarda el *estado* del schedule; Redis/BullMQ lo *ejecuta*.

**Redis:** colas de jobs (BullMQ), locks distribuidos del scheduler (evitar doble disparo en despliegues multi-instancia), caché de sesión conversacional y rate limiting de notificaciones.

### 2.5 APIs e Integraciones Externas

| Integración | API | Notas técnicas |
|-------------|-----|----------------|
| Telegram | `api.telegram.org/bot<token>` — métodos `sendMessage`, `sendVoice`, `answerCallbackQuery`, `setWebhook` | Webhook HTTPS con secret token de validación. Los botones inline (`InlineKeyboardMarkup`) son clave para UX del check-out: "✅ Hecha / ⏭ Posponer / ❌ Cancelar" con un tap |
| Web Push | Protocolo Web Push + VAPID | Requiere Service Worker en la PWA; almacenar `push_subscriptions` por dispositivo |
| Email saliente | SES/SendGrid REST API | Webhooks de bounce y apertura alimentan `notification_deliveries.status` |
| Email pendiente del usuario (RF-05) | v1: registro manual/conversacional. v2: OAuth Gmail/Microsoft Graph para detectar borradores y correos sin responder | La integración de lectura de buzón es un módulo separado con scopes mínimos |
| Calendario (reuniones) | v1: gestión interna. v2: Google Calendar API / MS Graph (sincronización bidireccional) | Sincronizar `events` con `external_ref` |
| STT/TTS | Whisper API / TTS API | Audios se almacenan en object storage; sólo la transcripción va a PostgreSQL |
| LLM | Claude API con tool use | Herramientas expuestas: `create_task`, `update_task_status`, `reschedule`, `get_daily_summary`, `log_progress` |

---

## 3. Modelo de Datos

### 3.1 Diagrama Entidad-Relación (lógico)

```
users ──1:N── projects ──1:N── tasks ──1:N── reminders
  │                              │  │
  │                              │  └──1:N── task_status_history
  │                              │
  ├──1:N── events (reuniones/llamadas con hora) ──N:1── tasks (opcional)
  ├──1:N── daily_sessions (check-in / check-out)
  ├──1:N── notifications ──1:N── notification_deliveries
  ├──1:N── interaction_logs
  ├──1:N── reports
  ├──1:N── channels (config. de canales del usuario)
  └──1:N── engagement_state (estado del motor de proactividad)
```

### 3.2 DDL de Referencia (PostgreSQL)

```sql
-- ============ NÚCLEO ============

CREATE TABLE users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'America/Santiago',
    workday_start   TIME NOT NULL DEFAULT '08:30',   -- dispara check-in
    workday_end     TIME NOT NULL DEFAULT '18:30',   -- dispara check-out
    work_days       SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}', -- ISO dow
    voice_enabled   BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE channels (
    channel_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users,
    channel_type    TEXT NOT NULL CHECK (channel_type IN
                        ('WEB_PUSH','DESKTOP_POPUP','EMAIL','TELEGRAM')),
    address         JSONB NOT NULL,  -- subscription push / email / chat_id
    is_verified     BOOLEAN NOT NULL DEFAULT false,
    priority        SMALLINT NOT NULL DEFAULT 1, -- orden de escalamiento
    quiet_hours     JSONB,           -- {"from":"22:00","to":"07:00"}
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, channel_type, address)
);

CREATE TABLE projects (
    project_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
    color           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ TAREAS Y EVENTOS ============

CREATE TABLE tasks (
    task_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users,
    project_id      UUID REFERENCES projects,
    task_type       TEXT NOT NULL CHECK (task_type IN
        ('EMAIL_SEND','REPORT','PHONE_CALL','MEETING',
         'DEADLINE','AGREEMENT','PROJECT_MILESTONE','GENERIC')),
    title           TEXT NOT NULL,
    description     TEXT,
    payload         JSONB,          -- campos específicos por tipo:
                                    -- EMAIL_SEND: {to, subject, draft_ref}
                                    -- PHONE_CALL: {contact, phone}
                                    -- REPORT: {recipient, format}
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
        ('PENDING','IN_PROGRESS','BLOCKED','DONE','CANCELLED','DEFERRED')),
    priority        SMALLINT NOT NULL DEFAULT 3,  -- 1=crítica .. 5=baja
    due_at          TIMESTAMPTZ,
    scheduled_for   DATE,           -- día planificado (check-in lo fija)
    defer_count     INT NOT NULL DEFAULT 0,  -- nº de veces pospuesta
    completed_at    TIMESTAMPTZ,
    progress_pct    SMALLINT CHECK (progress_pct BETWEEN 0 AND 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_tasks_user_status_due ON tasks (user_id, status, due_at);
CREATE INDEX ix_tasks_user_scheduled  ON tasks (user_id, scheduled_for)
    WHERE status NOT IN ('DONE','CANCELLED');

-- Historial de transiciones (auditoría + insumo de analítica)
CREATE TABLE task_status_history (
    history_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id         UUID NOT NULL REFERENCES tasks,
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    changed_by      TEXT NOT NULL,  -- 'USER' | 'SYSTEM' | 'CHECKIN' | 'CHECKOUT'
    note            TEXT,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users,
    task_id         UUID REFERENCES tasks,      -- opcional
    event_type      TEXT NOT NULL CHECK (event_type IN
                        ('MEETING','PHONE_CALL','COMMITMENT')),
    title           TEXT NOT NULL,
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ,
    location        TEXT,
    external_ref    JSONB,          -- id de Google Calendar/Graph (v2)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_events_user_start ON events (user_id, starts_at);

CREATE TABLE reminders (
    reminder_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID REFERENCES tasks,
    event_id        UUID REFERENCES events,
    remind_at       TIMESTAMPTZ NOT NULL,
    rule            JSONB,          -- recurrencia RRULE si aplica
    escalation_policy JSONB,        -- override de política por recordatorio
    status          TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN
        ('SCHEDULED','FIRED','ACKNOWLEDGED','ESCALATED','EXPIRED','CANCELLED')),
    job_id          TEXT,           -- id del job en BullMQ (trazabilidad)
    CHECK (task_id IS NOT NULL OR event_id IS NOT NULL)
);
CREATE INDEX ix_reminders_due ON reminders (remind_at)
    WHERE status = 'SCHEDULED';

-- ============ PROACTIVIDAD Y SESIONES ============

CREATE TABLE daily_sessions (
    session_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users,
    session_date    DATE NOT NULL,
    session_type    TEXT NOT NULL CHECK (session_type IN ('CHECKIN','CHECKOUT')),
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
        ('PENDING','TRIGGERED','IN_PROGRESS','COMPLETED','MISSED')),
    triggered_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    summary         JSONB,   -- snapshot: pendientes, planificadas, resultado
    UNIQUE (user_id, session_date, session_type)
);

CREATE TABLE engagement_state (
    user_id             UUID PRIMARY KEY REFERENCES users,
    last_interaction_at TIMESTAMPTZ,
    last_channel        TEXT,
    current_state       TEXT NOT NULL DEFAULT 'IDLE' CHECK (current_state IN
        ('IDLE','ENGAGED','AWAITING_CHECKIN','AWAITING_CHECKOUT',
         'NUDGING','ESCALATING','DORMANT')),
    nudge_level         SMALLINT NOT NULL DEFAULT 0,  -- nivel de escalamiento
    state_changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ NOTIFICACIONES ============

CREATE TABLE notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users,
    source_type     TEXT NOT NULL,   -- 'REMINDER','CHECKIN','CHECKOUT','REPORT','NUDGE'
    source_id       UUID,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    requires_ack    BOOLEAN NOT NULL DEFAULT false,
    acked_at        TIMESTAMPTZ,
    dedup_key       TEXT UNIQUE,     -- idempotencia (RNF-07)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE TABLE notification_deliveries (
    delivery_id     BIGINT GENERATED ALWAYS AS IDENTITY,
    notification_id UUID NOT NULL,
    channel_type    TEXT NOT NULL,
    attempt         SMALLINT NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN
        ('QUEUED','SENT','DELIVERED','READ','FAILED','BOUNCED')),
    provider_ref    TEXT,            -- message_id de Telegram/SES
    sent_at         TIMESTAMPTZ,
    status_at       TIMESTAMPTZ,
    PRIMARY KEY (delivery_id, sent_at)
) PARTITION BY RANGE (sent_at);

-- ============ LOGS Y REPORTES ============

CREATE TABLE interaction_logs (
    log_id          BIGINT GENERATED ALWAYS AS IDENTITY,
    user_id         UUID NOT NULL,
    channel_type    TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
    modality        TEXT NOT NULL CHECK (modality IN ('TEXT','VOICE')),
    content         TEXT,            -- texto o transcripción
    audio_ref       TEXT,            -- puntero a object storage si es voz
    intent          TEXT,            -- intención resuelta por el NLU
    session_id      UUID,            -- si ocurrió dentro de check-in/out
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (log_id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE reports (
    report_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users,
    period_type     TEXT NOT NULL CHECK (period_type IN ('DAILY','WEEKLY','MONTHLY')),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    metrics         JSONB NOT NULL,  -- ver §6.1
    file_ref        TEXT,            -- PDF en object storage
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, period_type, period_start)
);
```

### 3.3 Notas de Diseño del Modelo

- **`tasks.payload` (JSONB):** permite tipificar los siete tipos de tarea del RF-05 sin proliferar tablas; los campos comunes (estado, prioridad, vencimiento) permanecen relacionales y consultables.
- **`defer_count`:** insumo directo del Motor de Proactividad. Una tarea pospuesta 3+ veces gatilla una intervención especial en el check-in ("esta tarea la has pospuesto 3 días, ¿la partimos en subtareas, la delegamos o la cancelamos?").
- **`daily_sessions` con `UNIQUE(user, date, type)`:** garantiza a nivel de motor de BD que no se dispare dos veces el mismo ritual (idempotencia estructural).
- **Particionamiento mensual** en `interaction_logs`, `notifications` y `notification_deliveries`, con política de retención (detach + archive a object storage a los 12–24 meses).
- **`task_status_history`** es la tabla de hechos para la analítica: los reportes de "pendientes vs. realizados" se calculan sobre transiciones, no sobre el estado actual, lo que permite reconstruir cualquier corte temporal.

---

## 4. Especificación Funcional de los Módulos

### 4.1 Módulo Conversacional (voz y texto)

- **Entrada texto:** chat en PWA/escritorio y mensajes de Telegram convergen en el mismo pipeline NLU.
- **Entrada voz:** audio capturado (navegador o nota de voz de Telegram) → object storage → STT → texto → pipeline NLU. La transcripción se persiste en `interaction_logs`.
- **NLU con LLM + function calling:** el modelo mapea lenguaje natural a operaciones del dominio (crear tarea, marcar hecha, posponer, consultar agenda). Toda escritura pasa por el Módulo de Tareas (el LLM nunca escribe directo a la BD).
- **Salida:** respuesta en texto siempre; TTS opcional según canal y preferencia (`users.voice_enabled`). En Telegram, respuesta con botones inline para minimizar fricción.

### 4.2 Servicio de Notificaciones Omnicanal

Orquestador único que recibe eventos `notification.requested` desde el bus y aplica:

1. **Selección de canal** según `channels.priority` del usuario y contexto (¿hay sesión activa en la PWA? → popup; ¿fuera del PC? → Telegram).
2. **Política de escalamiento** (configurable, default):
   - t0: canal primario (popup si hay presencia; si no, Telegram).
   - t0 + 10 min sin `ack` y `requires_ack = true`: segundo canal (Telegram).
   - t0 + 30 min: email + marca de `ESCALATED`.
3. **Quiet hours:** respeto de `channels.quiet_hours` salvo notificaciones de prioridad crítica.
4. **Idempotencia:** `dedup_key` = hash(user, source, ventana temporal); reintentos de jobs no duplican envíos.
5. **Confirmación de entrega:** webhooks (Telegram delivery, SES bounce/open) actualizan `notification_deliveries`.

### 4.3 Módulo de Gestión de Tareas y Eventos

- CRUD completo con máquina de estados estricta:
  `PENDING → IN_PROGRESS → DONE` | `PENDING → DEFERRED (reagenda + defer_count++)` | `→ BLOCKED` | `→ CANCELLED`.
- Toda transición inserta en `task_status_history` (trigger o capa de servicio).
- Al crear/editar una tarea con `due_at`, se generan `reminders` automáticos según plantilla por tipo (ej.: MEETING → T-24h, T-1h, T-10min; DEADLINE → T-3d, T-1d, T-4h).

---

## 5. Motor de Proactividad

Es el corazón del producto. Se compone de tres piezas: **(a)** un scheduler confiable, **(b)** una máquina de estados de engagement por usuario, y **(c)** políticas de nudging/escalamiento.

### 5.1 Principio de Diseño

> El sistema nunca depende de un input del usuario para actuar. Todo comportamiento proactivo nace de **jobs programados** o de **eventos de dominio**, y el silencio del usuario es en sí mismo un evento (`user.inactive`).

### 5.2 Infraestructura de Scheduling

- **Jobs recurrentes por usuario** en BullMQ (repeatable jobs) calculados en la TZ del usuario:
  - `checkin:{user_id}` → cron derivado de `workday_start` y `work_days`.
  - `checkout:{user_id}` → cron derivado de `workday_end`.
  - `inactivity_scan` → job global cada 15 min que evalúa `engagement_state`.
  - `report:daily|weekly|monthly:{user_id}`.
- **Locks distribuidos en Redis** garantizan disparo único con múltiples instancias del worker.
- **Reconciliación al arranque:** al iniciar, el worker compara los repeatable jobs de Redis contra `users` + `daily_sessions` en PostgreSQL y repara faltantes (si Redis se vació, la fuente de verdad del schedule es la BD). Además, un job de *catch-up* detecta rituales `PENDING` cuya hora ya pasó (caída del sistema) y los dispara con marca de atraso.
- **Idempotencia:** antes de disparar un check-in, `INSERT ... ON CONFLICT DO NOTHING` sobre `daily_sessions`; si la fila ya existe en estado ≠ PENDING, el job aborta.

### 5.3 Máquina de Estados de Engagement (por usuario)

```
            (cron check-in)                  (usuario responde)
   IDLE ──────────────────► AWAITING_CHECKIN ─────────────────► ENGAGED
    ▲                            │ sin respuesta 15 min                │
    │                            ▼                                     │
    │                         NUDGING (nivel 1: popup/Telegram)        │
    │                            │ sin respuesta 30 min                │
    │                            ▼                                     │
    │                         ESCALATING (nivel 2: Telegram + email)   │
    │                            │ sin respuesta al cierre del día     │
    │                            ▼                                     │
    │                         DORMANT (check-in marcado MISSED;        │
    │                          se reporta en métricas y el check-in    │
    │                          del día siguiente arranca con ello)     │
    └────────────────────────────┴──── cualquier interacción del usuario
                                        resetea a ENGAGED/IDLE
```

- **Toda interacción entrante** (mensaje, tap en botón, apertura de la app) ejecuta `engagement_state.last_interaction_at = now()` y resuelve el estado. Esta es la señal universal de "el usuario está vivo".
- El **`inactivity_scan`** (cada 15 min) evalúa por usuario:
  - `AWAITING_CHECKIN/CHECKOUT` + `now() - triggered_at > umbral` → avanza `nudge_level` y encola `notification.requested` con tono progresivo (recordatorio suave → insistente → resumen por email "esto es lo que te estás perdiendo").
  - `ENGAGED` sin interacción > 4 h dentro de horario laboral y con tareas críticas del día sin movimiento → nudge contextual ("¿cómo va el informe X? Vence a las 17:00").

### 5.4 Flujo del Check-in Matutino (RF-06)

1. **Trigger:** job `checkin:{user}` a la hora `workday_start` (solo `work_days`). Crea `daily_sessions(CHECKIN, TRIGGERED)` y estado `AWAITING_CHECKIN`.
2. **Composición del brief** (query de una sola pasada):
   - Tareas `PENDING/IN_PROGRESS` con `scheduled_for = ayer` no completadas → "arrastre".
   - Tareas y eventos con `due_at/starts_at = hoy`.
   - Tareas con `defer_count >= 3` → sección "atascadas".
   - Resultado del check-out anterior (si fue `MISSED`, se dice explícitamente).
3. **Entrega proactiva:** popup si hay presencia + mensaje Telegram con el brief y botones; opcionalmente TTS ("Buenos días. Te quedaron 3 pendientes de ayer...").
4. **Diálogo de planificación asistida:** el asistente propone prioridades (por vencimiento, prioridad y arrastre) y negocia con el usuario: cada confirmación fija `scheduled_for = hoy` y reordena `priority`. Reglas heurísticas v1; scoring aprendido v2.
5. **Cierre:** sesión → `COMPLETED` con `summary` (snapshot del plan del día); estado → `ENGAGED`. Si no hay respuesta, opera la máquina de estados de §5.3.

### 5.5 Flujo del Check-out Vespertino (RF-07)

1. **Trigger:** job `checkout:{user}` a la hora `workday_end`.
2. **Interrogatorio guiado (una tarea a la vez, mínima fricción):** por cada tarea con `scheduled_for = hoy` no cerrada, pregunta con botones: **✅ Hecha / 🔄 Avancé (%) / ⏭ Mañana / 📅 Otra fecha / ❌ Cancelar**. Cada respuesta ejecuta la transición correspondiente (DEFERRED incrementa `defer_count` y exige nueva fecha: *no existe posponer sin destino*).
3. **Replanificación estratégica:** con lo no realizado, el asistente propone la estrategia del día siguiente: repartir carga, sugerir partir tareas grandes, advertir sobrecarga ("mañana tendrías 9 tareas; sugiero mover estas 2 al jueves").
4. **Reporte diario inmediato:** al cerrar la sesión se calcula y presenta el reporte del día (§6) y se persiste en `reports`.
5. **Refuerzo de hábito:** métrica de racha (días consecutivos con check-in y check-out completados) mostrada al cierre — mecánica de streak para combatir el abandono.

### 5.6 Recordatorios de Tareas y Eventos

- Cada `reminder` con `status = SCHEDULED` corresponde a un delayed job en BullMQ (con `job_id` persistido para cancelación si la tarea se completa antes).
- Al disparar: `reminder → FIRED`, se emite `notification.requested` con `requires_ack` según criticidad; sin ack, el Servicio de Notificaciones escala por canales (§4.2).

---

## 6. Módulo de Analítica y Reportabilidad

### 6.1 Métricas Base (calculadas sobre `task_status_history` + `daily_sessions`)

| Métrica | Definición |
|---------|------------|
| Tasa de cumplimiento | tareas DONE en el período / tareas planificadas (`scheduled_for` en el período) |
| Índice de arrastre | tareas que cruzaron de un día a otro / total planificadas |
| Tasa de postergación | Σ `defer_count` incrementados en el período / tareas activas |
| Puntualidad de deadlines | DONE con `completed_at <= due_at` / DONE con `due_at` |
| Adherencia al ritual | sesiones COMPLETED / sesiones esperadas (check-in y check-out) |
| Racha de hábito | días laborales consecutivos con ambos rituales completados |
| Distribución por tipo/proyecto | volumen y cumplimiento segmentado por `task_type` y `project_id` |

### 6.2 Generación y Entrega

- **Diario:** calculado en línea al completar el check-out (o por job de respaldo a `workday_end + 1h` si el check-out fue MISSED — el reporte sale igual, y lo dice: "hoy no cerraste el día").
- **Semanal:** job los viernes al check-out (o domingo noche), comparativo contra semana anterior, top de tareas atascadas.
- **Mensual:** primer día hábil del mes; tendencias, mejores/peores días, evolución de la adherencia.
- **Formato:** resumen en el canal conversacional + PDF adjunto por email (plantilla HTML → PDF), persistido en `reports.file_ref`.
- Las agregaciones semanales/mensuales se materializan (materialized views o tablas resumen pobladas por el job) para no recalcular sobre particiones históricas.

---

## 7. Consideraciones de Seguridad

- Autenticación con JWT + refresh tokens; vinculación de Telegram mediante deep-link con token de un solo uso (`/start <nonce>`), verificado contra `channels`.
- Validación del secret token en el webhook de Telegram; verificación de firmas en webhooks de email.
- Tokens y claves (bot, VAPID, API keys) exclusivamente en secret manager; nunca en la BD.
- Datos personales y transcripciones cifrados en reposo; retención configurable de `interaction_logs`.
- Rate limiting por canal para evitar auto-spam ante bugs del motor (fusible: máx. N notificaciones/usuario/hora).

---

## 8. Roadmap Sugerido de Implementación

| Fase | Alcance | Criterio de salida |
|------|---------|--------------------|
| **F1 — Núcleo (MVP)** | Modelo de datos, CRUD de tareas, Bot de Telegram bidireccional, scheduler con check-in/check-out por Telegram, reporte diario en texto | Un usuario vive 2 semanas completas gestionado solo por Telegram |
| **F2 — Omnicanal** | PWA con Web Push, wrapper de escritorio con popups nativos, email transaccional, política de escalamiento completa | Escalamiento popup→Telegram→email operando end-to-end |
| **F3 — Voz + NLU avanzado** | STT/TTS, creación de tareas por lenguaje natural con LLM y function calling | Check-in completo realizable 100% por voz |
| **F4 — Analítica plena** | Reportes semanales/mensuales en PDF, métricas de hábito, panel de tendencias | Reportes automáticos entregándose sin intervención |
| **F5 — Integraciones** | Google Calendar/MS Graph, lectura de buzón para emails pendientes | Sincronización bidireccional estable |

---

## 9. Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Caída del scheduler = producto inservible | Crítico | Workers redundantes, locks Redis, reconciliación al arranque, job de catch-up, alertas si un cron esperado no ejecutó (dead-man's switch en monitoreo) |
| Fatiga de notificaciones → el usuario silencia el bot | Alto | Escalamiento progresivo, quiet hours, consolidación de nudges, tono adaptativo, fusible de rate limit |
| El "obligar" del check-out se percibe invasivo | Medio | Fricción mínima (botones de un tap), duración objetivo < 3 min, streaks como refuerzo positivo en vez de castigo |
| Deriva de doble fuente de verdad (Redis vs. PostgreSQL) | Alto | PostgreSQL es la única fuente de verdad del schedule; Redis es ejecutor reconstruible |
| Costos de LLM/TTS en uso intensivo | Medio | Respuestas templadas para flujos estructurados (check-in/out usan plantillas + botones); LLM solo para lenguaje libre |
