// Parses lines in Obsidian Tasks plugin format:
// - [ ] Task title 📅 YYYY-MM-DD ⏫ [id:: uuid]

export interface ParsedTask {
  rawLine:  string;
  checked:  boolean;
  title:    string;
  taskId:   string | null;  // from [id:: uuid]
  dueDate:  string | null;  // from 📅 YYYY-MM-DD
  priority: number;         // 1=⏫ 2=🔼 3=normal 4=🔽 5=⬇️
}

const TASK_LINE_RE = /^(\s*)- \[([ x])\] (.+)$/;
const ID_RE        = /\[id::\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/i;
const DUE_DATE_RE  = /📅\s*(\d{4}-\d{2}-\d{2})/;

const PRIORITY_EMOJIS = [
  { emoji: '⏫', value: 1 },
  { emoji: '🔼', value: 2 },
  { emoji: '🔽', value: 4 },
  { emoji: '⬇️', value: 5 },
] as const;

/** Returns a ParsedTask if the line is an Obsidian task line, otherwise null. */
export function parseTaskLine(line: string): ParsedTask | null {
  const match = TASK_LINE_RE.exec(line);
  if (!match) return null;

  const checked = match[2] === 'x';
  let content   = match[3];

  // Extract id
  const idMatch = ID_RE.exec(content);
  const taskId  = idMatch ? idMatch[1] : null;
  if (idMatch) content = content.replace(idMatch[0], '').trim();

  // Extract due date
  const dueDateMatch = DUE_DATE_RE.exec(content);
  const dueDate      = dueDateMatch ? dueDateMatch[1] : null;
  if (dueDateMatch) content = content.replace(dueDateMatch[0], '').trim();

  // Extract priority (check in order; first match wins)
  let priority = 3;
  for (const { emoji, value } of PRIORITY_EMOJIS) {
    if (content.includes(emoji)) {
      priority = value;
      content  = content.replace(emoji, '').trim();
      break;
    }
  }

  return { rawLine: line, checked, title: content.trim(), taskId, dueDate, priority };
}

/** Parses all task lines in a markdown file's content. */
export function parseAllTaskLines(fileContent: string): ParsedTask[] {
  return fileContent
    .split('\n')
    .map(parseTaskLine)
    .filter((t): t is ParsedTask => t !== null);
}

/**
 * Inserts or replaces the [id:: uuid] field in a task line.
 * Preserves indentation and the rest of the line.
 */
export function injectTaskId(rawLine: string, taskId: string): string {
  const match = TASK_LINE_RE.exec(rawLine);
  if (!match) return rawLine;

  // Remove existing id if any
  const content = match[3].replace(ID_RE, '').trim();
  return `${match[1]}- [${match[2]}] ${content} [id:: ${taskId}]`;
}
