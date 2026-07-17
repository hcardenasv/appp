import { parseTaskLine, parseAllTaskLines, injectTaskId } from './task.parser';

const UUID = '7f3a1b2c-dead-beef-cafe-000000000001';

describe('parseTaskLine', () => {
  it('returns null for non-task lines', () => {
    expect(parseTaskLine('')).toBeNull();
    expect(parseTaskLine('# Heading')).toBeNull();
    expect(parseTaskLine('Some plain text')).toBeNull();
    expect(parseTaskLine('- No checkbox')).toBeNull();
  });

  it('parses a bare unchecked task', () => {
    const result = parseTaskLine('- [ ] Comprar pan');
    expect(result).toEqual({
      rawLine: '- [ ] Comprar pan',
      checked:  false,
      title:    'Comprar pan',
      taskId:   null,
      dueDate:  null,
      priority: 3,
    });
  });

  it('parses a checked task', () => {
    const result = parseTaskLine('- [x] Tarea completada');
    expect(result?.checked).toBe(true);
    expect(result?.title).toBe('Tarea completada');
  });

  it('extracts the task id from [id:: uuid]', () => {
    const result = parseTaskLine(`- [ ] Revisar propuesta [id:: ${UUID}]`);
    expect(result?.taskId).toBe(UUID);
    expect(result?.title).toBe('Revisar propuesta');
  });

  it('extracts the due date from 📅 emoji', () => {
    const result = parseTaskLine('- [ ] Llamar al médico 📅 2026-07-17');
    expect(result?.dueDate).toBe('2026-07-17');
    expect(result?.title).toBe('Llamar al médico');
  });

  it('maps ⏫ to priority 1', () => {
    const result = parseTaskLine('- [ ] Urgente ⏫');
    expect(result?.priority).toBe(1);
    expect(result?.title).toBe('Urgente');
  });

  it('maps 🔼 to priority 2', () => {
    const result = parseTaskLine('- [ ] Alta prioridad 🔼');
    expect(result?.priority).toBe(2);
  });

  it('maps 🔽 to priority 4', () => {
    const result = parseTaskLine('- [ ] Baja prioridad 🔽');
    expect(result?.priority).toBe(4);
  });

  it('maps ⬇️ to priority 5', () => {
    const result = parseTaskLine('- [ ] Mínima prioridad ⬇️');
    expect(result?.priority).toBe(5);
  });

  it('defaults to priority 3 with no emoji', () => {
    const result = parseTaskLine('- [ ] Tarea normal');
    expect(result?.priority).toBe(3);
  });

  it('parses a full task with all fields', () => {
    const line   = `- [ ] Revisar propuesta 📅 2026-07-17 ⏫ [id:: ${UUID}]`;
    const result = parseTaskLine(line);
    expect(result?.title).toBe('Revisar propuesta');
    expect(result?.dueDate).toBe('2026-07-17');
    expect(result?.priority).toBe(1);
    expect(result?.taskId).toBe(UUID);
    expect(result?.checked).toBe(false);
  });

  it('parses a checked task with id', () => {
    const line   = `- [x] Tarea hecha [id:: ${UUID}]`;
    const result = parseTaskLine(line);
    expect(result?.checked).toBe(true);
    expect(result?.taskId).toBe(UUID);
  });

  it('handles indented task lines', () => {
    const result = parseTaskLine('  - [ ] Subtarea indentada');
    expect(result).not.toBeNull();
    expect(result?.title).toBe('Subtarea indentada');
  });
});

describe('parseAllTaskLines', () => {
  it('extracts only task lines from a file', () => {
    const content = [
      '# Mi nota',
      '',
      '- [ ] Primera tarea',
      'Texto normal',
      `- [x] Segunda tarea [id:: ${UUID}]`,
      '## Sección',
    ].join('\n');

    const tasks = parseAllTaskLines(content);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe('Primera tarea');
    expect(tasks[1].checked).toBe(true);
    expect(tasks[1].taskId).toBe(UUID);
  });

  it('returns empty array for content without tasks', () => {
    expect(parseAllTaskLines('# Solo texto\n\nsin tareas')).toHaveLength(0);
  });
});

describe('injectTaskId', () => {
  it('appends [id:: uuid] to a task line without id', () => {
    const result = injectTaskId('- [ ] Nueva tarea', UUID);
    expect(result).toBe(`- [ ] Nueva tarea [id:: ${UUID}]`);
  });

  it('replaces existing id', () => {
    const oldId  = '00000000-0000-0000-0000-000000000000';
    const result = injectTaskId(`- [ ] Tarea [id:: ${oldId}]`, UUID);
    expect(result).toContain(UUID);
    expect(result).not.toContain(oldId);
  });

  it('preserves indentation', () => {
    const result = injectTaskId('  - [ ] Indented', UUID);
    expect(result.startsWith('  - [ ]')).toBe(true);
  });

  it('returns line unchanged if not a task line', () => {
    const line = '# Not a task';
    expect(injectTaskId(line, UUID)).toBe(line);
  });
});
