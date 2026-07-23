import Anthropic from '@anthropic-ai/sdk';
import { TASK_TYPES } from '../tasks/dto/create-task.dto';

export const CONVERSATION_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'create_task',
    description:
      'Crea una nueva tarea para el usuario. Úsala cuando el usuario mencione algo que quiere hacer, recordar o completar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskType: {
          type: 'string',
          enum: [...TASK_TYPES],
          description:
            'Tipo de tarea. Usa REMINDER cuando el usuario pida que se le recuerde algo a una hora específica. ' +
            'Usa MEETING para reuniones, PHONE_CALL para llamadas, DEADLINE para fechas límite, GENERIC para todo lo demás.',
        },
        title: { type: 'string', description: 'Título conciso de la tarea' },
        description: { type: 'string', description: 'Descripción opcional con más detalle' },
        priority: {
          type: 'integer',
          minimum: 1,
          maximum: 5,
          description: '1=urgente/importante, 3=normal, 5=baja prioridad',
        },
        dueAt: {
          type: 'string',
          description:
            'Momento exacto del recordatorio o fecha límite en ISO 8601 CON hora (ej: 2026-07-23T20:45:00). ' +
            'OBLIGATORIO para taskType=REMINDER — pon aquí la hora exacta en que debe llegar la notificación. ' +
            'También úsalo para reuniones, llamadas y deadlines con hora conocida.',
        },
        scheduledFor: {
          type: 'string',
          description:
            'Fecha (solo día, sin hora) en que se planea trabajar en la tarea (ISO 8601 date, ej: 2026-07-24). ' +
            'NO uses este campo para recordatorios con hora — usa dueAt en ese caso.',
        },
      },
      required: ['taskType', 'title'],
    },
  },
  {
    name: 'update_task_status',
    description:
      'Cambia el estado de una tarea. Úsala cuando el usuario indique que completó, bloqueó, pospuso o canceló una tarea.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'UUID de la tarea a modificar' },
        toStatus: {
          type: 'string',
          enum: ['IN_PROGRESS', 'DONE', 'BLOCKED', 'DEFERRED', 'CANCELLED'],
        },
        note: { type: 'string', description: 'Nota opcional sobre el cambio' },
        newScheduledFor: {
          type: 'string',
          description: 'Nueva fecha programada (ISO 8601). Requerido cuando toStatus=DEFERRED',
        },
      },
      required: ['taskId', 'toStatus'],
    },
  },
  {
    name: 'reschedule',
    description:
      'Reprograma una tarea a una nueva fecha sin cambiar su estado. Úsala para mover fechas de vencimiento o planificación.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'UUID de la tarea' },
        newScheduledFor: { type: 'string', description: 'Nueva fecha/hora programada (ISO 8601)' },
        newDueAt: { type: 'string', description: 'Nueva fecha límite (ISO 8601)' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'get_daily_summary',
    description:
      'Obtiene el resumen de tareas activas del usuario. Úsala cuando el usuario pregunte qué tiene pendiente, su agenda o cómo va el día.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'log_progress',
    description:
      'Registra el porcentaje de avance en una tarea. Úsala cuando el usuario reporte progreso parcial.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'UUID de la tarea' },
        progressPct: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: 'Porcentaje completado (0–100)',
        },
        note: { type: 'string', description: 'Nota sobre el avance' },
      },
      required: ['taskId', 'progressPct'],
    },
  },
];
