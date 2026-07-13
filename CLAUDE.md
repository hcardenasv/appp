# APPP — Asistente Personal Proactivo de Productividad

## Contexto obligatorio
Antes de escribir cualquier código, lee COMPLETOS estos dos documentos.
Son la fuente de verdad funcional y arquitectónica del proyecto:
- docs/especificacion-asistente-proactivo.md   (spec v1.0: requerimientos, arquitectura, modelo de datos, motor de proactividad)
- docs/anexo-A-obsidian-claude-docker.md       (anexo v1.1: Obsidian, Claude API, Docker/Linux, clientes Windows/Android)
Ante cualquier conflicto entre ambos, prevalece el Anexo A (v1.1).

## Reglas de arquitectura NO negociables
1. PostgreSQL es la ÚNICA fuente de verdad del estado. Redis es efímero
   y reconstruible. El vault de Obsidian es una proyección, nunca el motor.
2. El scheduling de negocio vive en BullMQ (worker), jamás en pg_cron
   ni en crontab del host.
3. Todo job es idempotente: usar dedup_key en notificaciones y
   UNIQUE(user_id, session_date, session_type) en daily_sessions.
4. Claude API nunca escribe directo a la BD: siempre a través de las
   tools del Módulo de Tareas, que validan.
5. Los flujos estructurados (botones del check-out, recordatorios)
   usan plantillas, NO consumen LLM.
6. El vault-agent solo escribe dentro de la subcarpeta APPP/ del vault.
7. Toda transición de estado de una tarea inserta en task_status_history.
8. Todo el scheduling opera en la timezone del usuario (users.timezone,
   default America/Santiago). Nunca asumir UTC en lógica de negocio.

## Stack
- Backend: Node.js 22 LTS + NestJS + TypeScript estricto
- BD: PostgreSQL 16 (migraciones con Prisma Migrate; el DDL de
  referencia está en la spec §3.2 — respetarlo, incluidas particiones)
- Colas/scheduler: Redis 7 + BullMQ
- Bot: Telegram vía grammY, modo LONG POLLING (no webhook en F1)
- IA: SDK oficial @anthropic-ai/sdk; modelo configurable por función
  vía variables de entorno (NLU y planificación separados)
- Todo corre en Docker Compose (compose de referencia en Anexo A §A.4.2)

## Estructura del monorepo
appp/
├── CLAUDE.md
├── docs/                  # especificaciones (solo lectura)
├── docker-compose.yml
├── .env.example           # TODAS las variables, sin valores reales
├── app/                   # NestJS: API + bot Telegram + módulos
│   └── src/
│       ├── modules/tasks/          # CRUD + máquina de estados
│       ├── modules/conversation/   # NLU con Claude + tools
│       ├── modules/notifications/  # orquestador omnicanal
│       ├── modules/proactivity/    # motor: sesiones, engagement, nudges
│       ├── modules/reports/        # métricas y reportes
│       └── worker.ts               # entrypoint del worker BullMQ
├── vault-agent/            # watcher + escritor markdown (proceso aparte)
└── scripts/                # utilitarios de operación

## Convenciones
- Commits en español, formato conventional commits (feat:, fix:, chore:)
- Tests: Jest; cobertura mínima en la máquina de estados de tareas,
  la idempotencia del scheduler y el parser del vault-agent
- Nada de secretos en el repo: solo .env.example
- Español para mensajes al usuario final; inglés para código e
  identificadores

## Comandos
- Levantar entorno: docker compose up -d postgres redis
- Dev API: cd app && npm run start:dev
- Dev worker: cd app && npm run start:worker
- Migraciones: cd app && npx prisma migrate dev
- Tests: cd app && npm test

## Fase actual: F1 (MVP núcleo self-hosted)
Alcance F1 según Anexo A §A.6. NO implementar todavía: vault-agent,
Syncthing, PWA, Web Push, voz, reportes semanales/mensuales, MCP.
Sí implementar: modelo de datos completo (aunque F1 no use todas las
tablas), bot Telegram, check-in/check-out, recordatorios con
escalamiento simple (Telegram → email), NLU básico con Claude,
reporte diario en texto.
