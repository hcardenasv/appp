# Anexo A — Especificación v1.1
## Integración con Obsidian, Claude como Motor de IA y Despliegue Self-Hosted (Docker/Linux)

**Complementa a:** Especificación Funcional y Técnica v1.0 — Asistente Personal Proactivo de Productividad (APPP)
**Motivación:** El usuario opera con Obsidian como sistema personal de conocimiento, requiere despliegue on-premise en servidor Linux vía Docker, y consumo desde Windows (escritorio) y dispositivo móvil.

---

## A.1 Impacto en las Decisiones de Arquitectura v1.0

| Decisión v1.0 | Cambio en v1.1 | Justificación |
|---------------|----------------|---------------|
| PWA/Electron como interfaz principal | La PWA se mantiene pero pierde protagonismo; **Obsidian se convierte en la capa de conocimiento y lectura**, y **Telegram en el canal proactivo principal** | Obsidian ya es el hábito instalado del usuario; el APPP debe insertarse en él, no competir |
| LLM genérico vía API | **Claude API (Anthropic)** como motor único de NLU, planificación asistida y redacción de reportes | Tool use maduro, buen desempeño en español, un solo proveedor simplifica secretos y costos |
| Despliegue no especificado | **Docker Compose sobre servidor Linux propio**, todo self-hosted salvo APIs externas (Claude, Telegram) | Control total, datos en casa; perfil del usuario domina Linux/servidores |
| Popups nativos vía wrapper Electron/Tauri | **Web Push (PWA instalada) + Telegram Desktop** cubren el escritorio Windows sin desarrollar wrapper en F1-F2 | Reduce alcance del MVP; el wrapper queda como opción F3+ |

**Principio que NO cambia:** PostgreSQL sigue siendo la **única fuente de verdad del estado** (status, scheduling, métricas, engagement). Obsidian es una **proyección legible y editable** de ese estado, nunca el motor. Esta separación es la que evita el clásico problema de los plugins de tareas de Obsidian: el vault no puede disparar notificaciones ni escalar recordatorios por sí mismo — para eso existe el servidor.

---

## A.2 Integración con Obsidian

### A.2.1 Rol de Obsidian en el sistema

Obsidian cumple tres funciones:

1. **Espejo legible del estado (server → vault):** el servidor escribe y actualiza notas markdown en el vault: brief del check-in, acta del check-out, reportes diarios/semanales/mensuales, y una nota por proyecto con sus tareas vivas.
2. **Canal de entrada asíncrono (vault → server):** el usuario puede crear o editar tareas directamente en Obsidian usando la sintaxis del plugin **Obsidian Tasks** (`- [ ] Llamar a Pérez 📅 2026-07-15 ⏫`); un proceso *watcher* en el servidor detecta cambios y los ingesta a PostgreSQL.
3. **Archivo histórico y capa de análisis personal:** los reportes quedan como notas permanentes, consultables con Dataview, enlazables al resto del vault del usuario.

### A.2.2 Mecanismo de sincronización

El vault **vive en el servidor Linux** (volumen Docker) y se replica a los dispositivos:

| Opción | Cómo | Recomendación |
|--------|------|---------------|
| **Syncthing** (self-hosted) | Contenedor Syncthing en el servidor ↔ Syncthing en Windows ↔ app Syncthing/Möbius en el móvil | **Recomendada**: gratuita, cifrada, sin nube de terceros, coherente con el despliegue on-premise |
| Obsidian Sync (oficial, pago) | El servidor actúa como "un dispositivo más" ejecutando Obsidian headless o montando el vault sincronizado | Válida si ya se paga; menos control |
| Git (obsidian-git) | Repositorio central en el servidor (bare repo), plugin obsidian-git en los clientes | Robusta pero con más fricción en móvil |

### A.2.3 Contrato de archivos (estructura del vault)

```
Vault/
└── APPP/                          ← subcarpeta gestionada por el sistema
    ├── 00-Inbox.md                ← el usuario tira tareas rápidas aquí
    ├── Diario/
    │   └── 2026-07-12.md          ← nota diaria: brief matutino + acta
    │                                 del check-out + métricas del día
    ├── Proyectos/
    │   └── Migracion-Exadata.md   ← una nota por proyecto (frontmatter
    │                                 con project_id, tareas Tasks-format)
    ├── Reportes/
    │   ├── Semanal/2026-W28.md
    │   └── Mensual/2026-07.md
    └── _sistema/
        └── estado.md              ← snapshot legible del engagement
```

Reglas del contrato:

- **Frontmatter con IDs:** cada tarea escrita por el servidor lleva un identificador embebido (`[id:: 7f3a…]` en formato Dataview inline o bloque `^task-id`). Es la clave de reconciliación bidireccional.
- **Ingesta vault → server:** el watcher (chokidar/inotify sobre el volumen) parsea diffs. Una tarea nueva sin ID → `INSERT` en `tasks` + reescritura del archivo agregando el ID. Un checkbox marcado `[x]` → transición a `DONE` (con `changed_by = 'OBSIDIAN'` en `task_status_history`).
- **Resolución de conflictos:** *last-writer-wins* con ventana de gracia; si servidor y vault difieren dentro de la misma ventana de sync, **gana PostgreSQL** y la discrepancia se anota en la nota diaria ("detecté una edición en conflicto en la tarea X, prevaleció el estado del sistema").
- **El servidor solo escribe dentro de `APPP/`**: jamás toca el resto del vault del usuario.

### A.2.4 Cambios al modelo de datos

```sql
ALTER TABLE tasks    ADD COLUMN obsidian_ref JSONB;
  -- {"file":"APPP/Proyectos/Migracion-Exadata.md","block_id":"^7f3a"}
ALTER TABLE reports  ADD COLUMN obsidian_path TEXT;
ALTER TABLE projects ADD COLUMN obsidian_path TEXT;

CREATE TABLE vault_sync_log (
    sync_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    direction   TEXT NOT NULL CHECK (direction IN ('VAULT_TO_DB','DB_TO_VAULT')),
    file_path   TEXT NOT NULL,
    entity_type TEXT,           -- TASK | REPORT | SESSION
    entity_id   UUID,
    action      TEXT NOT NULL,  -- CREATED | UPDATED | CONFLICT
    detail      JSONB,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Además, `task_status_history.changed_by` incorpora el valor `'OBSIDIAN'`.

---

## A.3 Claude como Motor de IA

### A.3.1 Funciones asignadas a Claude (vía Claude API)

| Función | Mecanismo | Flujo |
|---------|-----------|-------|
| NLU conversacional | Tool use: `create_task`, `update_task_status`, `reschedule`, `get_daily_summary`, `log_progress`, `split_task` | Mensaje libre (Telegram/PWA/voz transcrita) → Claude interpreta → invoca herramientas → el Módulo de Tareas valida y ejecuta (Claude nunca escribe directo a la BD) |
| Planificación asistida del check-in | Prompt con el brief estructurado (JSON de pendientes, arrastre, agenda) → Claude propone priorización razonada | La propuesta se presenta con botones; cada confirmación del usuario ejecuta las tools |
| Replanificación del check-out | Prompt con el resultado del día → Claude sugiere estrategia (repartir carga, partir tareas atascadas, advertir sobrecarga) | Reemplaza las heurísticas fijas de §5.5 con razonamiento contextual |
| Redacción de reportes | Las métricas se calculan en SQL (determinista); Claude redacta la narrativa ejecutiva del reporte semanal/mensual en markdown listo para el vault | Números por SQL, prosa por Claude — nunca al revés |
| Intervención en tareas atascadas | Ante `defer_count >= 3`, Claude genera la propuesta de desbloqueo (subtareas vía `split_task`, delegación o cancelación) | Se inyecta en el brief matutino |

### A.3.2 Reglas de diseño y control de costos

- **Flujos estructurados no consumen LLM:** el interrogatorio del check-out (botones ✅/🔄/⏭) y los recordatorios usan plantillas. Claude entra solo donde hay lenguaje libre o se requiere juicio (priorización, estrategia, redacción).
- **Modelo por tarea:** modelo liviano (Haiku) para NLU de mensajes cortos; modelo mayor (Sonnet) para planificación y reportes. Configurable por función.
- **Presupuesto y fusible:** contador de tokens/día en Redis; superado el umbral, el sistema degrada a heurísticas v1.0 y lo informa.
- **Privacidad:** hacia la API de Claude viaja únicamente el contexto mínimo necesario (títulos, fechas, estados); el vault completo jamás se envía. Clave API en secret manager/`.env` del servidor, nunca en clientes.
- **Trazabilidad:** cada invocación se registra en `interaction_logs` con `intent` y tools ejecutadas.

### A.3.3 Opcional — Servidor MCP (F3+)

Exponer el APPP como **servidor MCP** (Model Context Protocol) permite que Claude Desktop en Windows —o Claude Code en el servidor— opere el sistema directamente: "Claude, ¿cómo viene mi semana?" desde Claude Desktop consultaría las mismas herramientas (`get_daily_summary`, `create_task`) sin desarrollar UI adicional. Es un tercer cliente de escritorio a costo casi nulo, y coherente con que el usuario ya utiliza Claude.

---

## A.4 Despliegue: Docker Compose en Servidor Linux

### A.4.1 Topología

```
SERVIDOR LINUX (on-premise)
┌─────────────────────────────────────────────────────────────┐
│  docker compose                                              │
│                                                              │
│  ┌──────────┐   ┌───────────┐   ┌────────────┐              │
│  │ reverse   │   │ app (API  │   │ worker      │              │
│  │ proxy     │──►│ NestJS +  │   │ (BullMQ:    │              │
│  │ Caddy/    │   │ webhook   │   │ scheduler,  │              │
│  │ Traefik   │   │ Telegram +│   │ notificac., │              │
│  │ (TLS)     │   │ PWA)      │   │ reportes)   │              │
│  └────┬─────┘   └─────┬─────┘   └──────┬─────┘              │
│       │               │                 │                    │
│       │         ┌─────▼─────┐    ┌─────▼─────┐              │
│       │         │ postgres  │    │ redis      │              │
│       │         │ 16        │    │ 7          │              │
│       │         └───────────┘    └───────────┘              │
│       │                                                      │
│  ┌────▼───────┐  ┌─────────────┐  ┌───────────────────┐     │
│  │ vault-sync  │  │ vault-agent  │  │ backup (pgBackRest│     │
│  │ (Syncthing) │  │ (watcher +   │  │ /pg_dump + rclone)│     │
│  │             │  │  escritor md)│  │                   │     │
│  └────┬───────┘  └──────┬──────┘  └───────────────────┘     │
│       │    volumen compartido: /data/vault                   │
│       └──────────────────┘                                   │
└─────────────────────────────────────────────────────────────┘
   ▲ Syncthing (LAN/WAN cifrado)      ▲ HTTPS (webhook Telegram,
   │                                  │  PWA, Web Push)
   Windows (Obsidian + Syncthing)     Internet
   Móvil  (Obsidian + Möbius Sync)
```

### A.4.2 `docker-compose.yml` de referencia

```yaml
services:
  proxy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    restart: unless-stopped

  app:
    build: ./app                # API + PWA + webhook Telegram
    environment:
      DATABASE_URL: postgres://appp:${PG_PASS}@postgres:5432/appp
      REDIS_URL: redis://redis:6379
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY}
      TZ: America/Santiago
    depends_on: [postgres, redis]
    restart: unless-stopped

  worker:
    build: ./app
    command: ["node", "dist/worker.js"]   # scheduler + colas
    environment: *app-env                  # (anchor de las mismas vars)
    depends_on: [postgres, redis]
    restart: unless-stopped

  vault-agent:
    build: ./vault-agent        # watcher inotify + escritor markdown
    volumes:
      - vault:/vault
    environment:
      DATABASE_URL: postgres://appp:${PG_PASS}@postgres:5432/appp
      VAULT_SUBDIR: APPP
    restart: unless-stopped

  syncthing:
    image: syncthing/syncthing:1
    volumes:
      - vault:/var/syncthing/vault
      - syncthing_cfg:/var/syncthing/config
    ports:
      - "8384:8384"             # GUI admin (restringir a LAN)
      - "22000:22000"           # sync TCP/QUIC
      - "21027:21027/udp"       # discovery
    restart: unless-stopped

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: appp
      POSTGRES_USER: appp
      POSTGRES_PASSWORD: ${PG_PASS}
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    restart: unless-stopped

volumes:
  pgdata: {}
  redisdata: {}
  vault: {}
  syncthing_cfg: {}
  caddy_data: {}
```

### A.4.3 Requisitos de red y exposición

| Necesidad | Detalle |
|-----------|---------|
| **HTTPS público para el webhook de Telegram** | Telegram exige webhook con certificado válido. Opciones: (a) dominio propio + DNS al IP público + Caddy con Let's Encrypt automático; (b) **Cloudflare Tunnel** si no se desea abrir puertos; (c) fallback: modo *long polling* del bot, que no requiere entrada alguna (recomendado si el servidor no es accesible desde Internet) |
| **PWA + Web Push** | Requiere HTTPS igualmente; mismas opciones anteriores. En LAN pura, certificado interno + acceso vía VPN (WireGuard) |
| **Syncthing** | No requiere exposición si los dispositivos usan relays/discovery global de Syncthing (tráfico cifrado extremo a extremo); en LAN sincroniza directo |
| **GUI de administración** (Syncthing :8384, métricas) | Solo LAN o detrás de VPN, nunca expuestas |

**Recomendación operativa:** para el MVP, bot de Telegram en **long polling** + Syncthing con discovery global + WireGuard para acceder a la PWA desde fuera. Cero puertos abiertos en el firewall. Migrar a webhook + dominio cuando el sistema esté estabilizado.

### A.4.4 Operación (perfil sysadmin del usuario)

- **Backups:** `pg_dump` diario + snapshot del volumen `vault` (el vault además está replicado en 2+ dispositivos vía Syncthing, lo que es un respaldo implícito). Redis no requiere backup estricto (reconstruible desde PostgreSQL, §5.2), pero AOF activado acelera la recuperación.
- **Dead-man's switch:** el worker toca un heartbeat cada ejecución del `inactivity_scan`; un healthcheck externo (Uptime Kuma en el mismo compose, o healthchecks.io) alerta si el latido cesa — mitiga el riesgo crítico R1 de la v1.0 ("scheduler caído = producto muerto").
- **Actualizaciones:** `docker compose pull && docker compose up -d`; migraciones de esquema con herramienta versionada (Flyway/Prisma Migrate) ejecutadas por el contenedor `app` al arrancar.
- **Recursos:** el stack completo corre holgado con 2 vCPU / 4 GB RAM / 20 GB disco (sin STT self-hosted; Whisper local subiría el requerimiento).

---

## A.5 Matriz de Clientes: Windows y Móvil

| Capacidad | Windows | Móvil (Android/iOS) |
|-----------|---------|---------------------|
| Rituales check-in / check-out | Telegram Desktop **o** PWA instalada (Edge/Chrome → "Instalar app") | **Telegram (canal principal)** o PWA |
| Popups / notificaciones nativas | Web Push de la PWA instalada (notifica aun con navegador cerrado en Windows) + notificaciones de Telegram Desktop | Push de Telegram (más confiable que Web Push en iOS) |
| Email | Cliente habitual | Cliente habitual |
| Voz (STT/TTS) | Micrófono en la PWA; notas de voz de Telegram | **Notas de voz de Telegram** (vía más natural en móvil) |
| Vista de conocimiento / edición markdown | **Obsidian Desktop** (vault sincronizado por Syncthing) | **Obsidian Mobile** (Syncthing-Fork en Android; Möbius Sync o Sync oficial en iOS) |
| Gestión visual completa (kanban, filtros) | PWA | PWA |
| Cliente IA adicional (F3+) | Claude Desktop conectado al servidor MCP del APPP | — |

Nota iOS: iOS no permite Syncthing nativo en background pleno; Möbius Sync (App Store) o el Sync oficial de Obsidian son las vías estables. En Android, Syncthing-Fork funciona sin restricciones.

---

## A.6 Ajustes al Roadmap (reemplaza §8 de v1.0)

| Fase | Alcance ajustado | Criterio de salida |
|------|------------------|--------------------|
| **F1 — Núcleo self-hosted** | Compose con postgres/redis/app/worker; bot Telegram (long polling); check-in/check-out por Telegram; Claude API para NLU básico; reporte diario en texto | Sistema corriendo en el servidor Linux; 2 semanas de rituales completados solo desde el móvil |
| **F2 — Capa Obsidian** | vault-agent (escritor md + watcher), Syncthing, notas diarias/proyectos/reportes en el vault, ingesta de tareas creadas en Obsidian | Tarea creada en Obsidian (Windows) aparece en la BD y es recordada por Telegram; reporte diario legible en el móvil vía Obsidian |
| **F3 — PWA + Web Push + voz** | PWA instalable en Windows, Web Push, STT/TTS, VPN WireGuard para acceso externo | Check-in completo por voz desde Windows; popups nativos operando |
| **F4 — Analítica plena + Claude estratégico** | Reportes semanales/mensuales con narrativa de Claude escritos al vault y enviados por email; métricas de hábito y streaks | Reportes automáticos sin intervención durante un mes |
| **F5 — Extensiones** | Servidor MCP para Claude Desktop, integración de calendario/buzón, webhook Telegram con dominio propio | Claude Desktop operando el APPP; sincronización de calendario estable |

---

## A.7 Riesgos Nuevos Introducidos por v1.1

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Conflictos de sincronización del vault (edición simultánea en 3 dispositivos + servidor) | Medio | Servidor escribe solo en `APPP/`; reconciliación por ID de bloque; PostgreSQL prevalece; conflictos visibles en la nota diaria; `vault_sync_log` auditable |
| El usuario edita masivamente notas del sistema en Obsidian rompiendo el formato | Medio | Parser tolerante; lo no parseable se reporta en la nota diaria sin perder datos (la verdad vive en la BD) |
| Dependencia de la API de Claude (corte o costo) | Medio | Degradación a heurísticas v1.0 (plantillas + reglas); los rituales y recordatorios funcionan 100% sin LLM |
| Servidor casero sin redundancia (corte de luz/red) | Alto para RNF-01 | UPS; job de catch-up al reinicio (§5.2) que dispara rituales atrasados; healthcheck externo con alerta al móvil |
| iOS limita sincronización en background | Bajo | Telegram como canal proactivo primario en móvil: las notificaciones nunca dependen del vault |
