-- APPP — Migración inicial
-- Spec §3.2 + Annexe A §A.2.4
--
-- DEVIACIONES DOCUMENTADAS respecto al DDL de referencia:
-- 1. notifications: PK cambia de (notification_id) a (notification_id, created_at)
--    porque PARTITION BY RANGE exige que la PK incluya la clave de partición.
-- 2. notification_deliveries: PK es (delivery_id, created_at), no (delivery_id, sent_at),
--    porque sent_at es nullable (se fija al enviar) y no puede ser clave de partición.
--    Se agrega created_at como clave de partición.
-- 3. channels.address: la restricción UNIQUE del spec no es posible en JSONB con índice
--    B-tree; se reemplaza por un índice de expresión sobre md5(address::text).
-- 4. users.email: CITEXT en lugar de TEXT (preserva semántica insensible a mayúsculas).
--    Requiere la extensión citext, disponible sin superusuario en PostgreSQL 15+ para
--    propietarios de la BD.

CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- CORE
-- ============================================================

CREATE TABLE users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'America/Santiago',
    workday_start   TIME NOT NULL DEFAULT '08:30',
    workday_end     TIME NOT NULL DEFAULT '18:30',
    work_days       SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
    voice_enabled   BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE channels (
    channel_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    channel_type    TEXT NOT NULL CHECK (channel_type IN
                        ('WEB_PUSH','DESKTOP_POPUP','EMAIL','TELEGRAM')),
    address         JSONB NOT NULL,
    is_verified     BOOLEAN NOT NULL DEFAULT false,
    priority        SMALLINT NOT NULL DEFAULT 1,
    quiet_hours     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Índice único por expresión: JSONB no es indexable con B-tree estándar.
CREATE UNIQUE INDEX uq_channels_user_type_addr
    ON channels (user_id, channel_type, md5(address::text));

CREATE TABLE projects (
    project_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
    color           TEXT,
    obsidian_path   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TAREAS Y EVENTOS
-- ============================================================

CREATE TABLE tasks (
    task_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    project_id      UUID REFERENCES projects ON DELETE SET NULL,
    task_type       TEXT NOT NULL CHECK (task_type IN
        ('EMAIL_SEND','REPORT','PHONE_CALL','MEETING',
         'DEADLINE','AGREEMENT','PROJECT_MILESTONE','GENERIC')),
    title           TEXT NOT NULL,
    description     TEXT,
    payload         JSONB,
    obsidian_ref    JSONB,
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
        ('PENDING','IN_PROGRESS','BLOCKED','DONE','CANCELLED','DEFERRED')),
    priority        SMALLINT NOT NULL DEFAULT 3,
    due_at          TIMESTAMPTZ,
    scheduled_for   DATE,
    defer_count     INT NOT NULL DEFAULT 0,
    completed_at    TIMESTAMPTZ,
    progress_pct    SMALLINT CHECK (progress_pct BETWEEN 0 AND 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_tasks_user_status_due ON tasks (user_id, status, due_at);
CREATE INDEX ix_tasks_user_scheduled  ON tasks (user_id, scheduled_for)
    WHERE status NOT IN ('DONE','CANCELLED');

CREATE TABLE task_status_history (
    history_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id         UUID NOT NULL REFERENCES tasks ON DELETE CASCADE,
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    changed_by      TEXT NOT NULL,
    note            TEXT,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    task_id         UUID REFERENCES tasks ON DELETE SET NULL,
    event_type      TEXT NOT NULL CHECK (event_type IN
                        ('MEETING','PHONE_CALL','COMMITMENT')),
    title           TEXT NOT NULL,
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ,
    location        TEXT,
    external_ref    JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_events_user_start ON events (user_id, starts_at);

CREATE TABLE reminders (
    reminder_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID REFERENCES tasks ON DELETE CASCADE,
    event_id            UUID REFERENCES events ON DELETE CASCADE,
    remind_at           TIMESTAMPTZ NOT NULL,
    rule                JSONB,
    escalation_policy   JSONB,
    status              TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN
        ('SCHEDULED','FIRED','ACKNOWLEDGED','ESCALATED','EXPIRED','CANCELLED')),
    job_id              TEXT,
    CHECK (task_id IS NOT NULL OR event_id IS NOT NULL)
);

CREATE INDEX ix_reminders_due ON reminders (remind_at)
    WHERE status = 'SCHEDULED';

-- ============================================================
-- PROACTIVIDAD Y SESIONES
-- ============================================================

CREATE TABLE daily_sessions (
    session_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    session_date    DATE NOT NULL,
    session_type    TEXT NOT NULL CHECK (session_type IN ('CHECKIN','CHECKOUT')),
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
        ('PENDING','TRIGGERED','IN_PROGRESS','COMPLETED','MISSED')),
    triggered_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    summary         JSONB,
    UNIQUE (user_id, session_date, session_type)
);

CREATE TABLE engagement_state (
    user_id             UUID PRIMARY KEY REFERENCES users ON DELETE CASCADE,
    last_interaction_at TIMESTAMPTZ,
    last_channel        TEXT,
    current_state       TEXT NOT NULL DEFAULT 'IDLE' CHECK (current_state IN
        ('IDLE','ENGAGED','AWAITING_CHECKIN','AWAITING_CHECKOUT',
         'NUDGING','ESCALATING','DORMANT')),
    nudge_level         SMALLINT NOT NULL DEFAULT 0,
    state_changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- NOTIFICACIONES
-- Particionado por RANGE (created_at). La PK debe incluir la clave de
-- partición: PRIMARY KEY (notification_id, created_at).
-- La unicidad de dedup_key se aplica por partición mediante índice de expresión.
-- ============================================================

CREATE TABLE notifications (
    notification_id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    source_type     TEXT NOT NULL,
    source_id       UUID,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    requires_ack    BOOLEAN NOT NULL DEFAULT false,
    acked_at        TIMESTAMPTZ,
    dedup_key       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, created_at)
) PARTITION BY RANGE (created_at);

-- Particiones mensuales Jul 2026 – Ene 2027
CREATE TABLE notifications_2026_07 PARTITION OF notifications
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE notifications_2026_08 PARTITION OF notifications
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE notifications_2026_09 PARTITION OF notifications
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE notifications_2026_10 PARTITION OF notifications
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE notifications_2026_11 PARTITION OF notifications
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE notifications_2026_12 PARTITION OF notifications
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE notifications_2027_01 PARTITION OF notifications
    FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE INDEX ix_notifications_user ON notifications (user_id, created_at);
-- Unicidad de dedup_key por partición (cross-partition unique no soportado en pg)
CREATE UNIQUE INDEX ix_notifications_dedup ON notifications (dedup_key, created_at)
    WHERE dedup_key IS NOT NULL;

-- notification_deliveries: sent_at es nullable (se fija al entregar).
-- Se usa created_at como clave de partición.
-- FK a notifications omitida: FK a tablas particionadas con PK compuesta requeriría
-- incluir created_at en esta tabla; se aplica integridad referencial en la capa de aplicación.
CREATE TABLE notification_deliveries (
    delivery_id     BIGINT GENERATED ALWAYS AS IDENTITY,
    notification_id UUID NOT NULL,
    channel_type    TEXT NOT NULL,
    attempt         SMALLINT NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN
        ('QUEUED','SENT','DELIVERED','READ','FAILED','BOUNCED')),
    provider_ref    TEXT,
    sent_at         TIMESTAMPTZ,
    status_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (delivery_id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE notification_deliveries_2026_07 PARTITION OF notification_deliveries
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE notification_deliveries_2026_08 PARTITION OF notification_deliveries
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE notification_deliveries_2026_09 PARTITION OF notification_deliveries
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE notification_deliveries_2026_10 PARTITION OF notification_deliveries
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE notification_deliveries_2026_11 PARTITION OF notification_deliveries
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE notification_deliveries_2026_12 PARTITION OF notification_deliveries
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE notification_deliveries_2027_01 PARTITION OF notification_deliveries
    FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE INDEX ix_notif_deliveries_notif ON notification_deliveries (notification_id, created_at);

-- ============================================================
-- LOGS DE INTERACCIÓN
-- Particionado por RANGE (created_at). FK a users es válida desde
-- tablas particionadas en PostgreSQL 12+.
-- ============================================================

CREATE TABLE interaction_logs (
    log_id          BIGINT GENERATED ALWAYS AS IDENTITY,
    user_id         UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    channel_type    TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
    modality        TEXT NOT NULL CHECK (modality IN ('TEXT','VOICE')),
    content         TEXT,
    audio_ref       TEXT,
    intent          TEXT,
    session_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (log_id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE interaction_logs_2026_07 PARTITION OF interaction_logs
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE interaction_logs_2026_08 PARTITION OF interaction_logs
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE interaction_logs_2026_09 PARTITION OF interaction_logs
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE interaction_logs_2026_10 PARTITION OF interaction_logs
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE interaction_logs_2026_11 PARTITION OF interaction_logs
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE interaction_logs_2026_12 PARTITION OF interaction_logs
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE interaction_logs_2027_01 PARTITION OF interaction_logs
    FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE INDEX ix_interaction_logs_user ON interaction_logs (user_id, created_at);

-- ============================================================
-- REPORTES
-- ============================================================

CREATE TABLE reports (
    report_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    period_type     TEXT NOT NULL CHECK (period_type IN ('DAILY','WEEKLY','MONTHLY')),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    metrics         JSONB NOT NULL,
    file_ref        TEXT,
    obsidian_path   TEXT,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, period_type, period_start)
);

-- ============================================================
-- VAULT SYNC LOG (Annexe A §A.2.4)
-- ============================================================

CREATE TABLE vault_sync_log (
    sync_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    direction   TEXT NOT NULL CHECK (direction IN ('VAULT_TO_DB','DB_TO_VAULT')),
    file_path   TEXT NOT NULL,
    entity_type TEXT,
    entity_id   UUID,
    action      TEXT NOT NULL CHECK (action IN ('CREATED','UPDATED','CONFLICT')),
    detail      JSONB,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
