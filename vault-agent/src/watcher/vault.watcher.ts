import { watch, FSWatcher } from 'chokidar';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseAllTaskLines, injectTaskId } from './task.parser';
import { createTask, markTaskDone, getTaskById, logVaultSync } from '../db';

// Tracks files the vault-agent itself just wrote to avoid self-trigger loops
const agentWrittenFiles = new Set<string>();

export function markAgentWrite(filePath: string): void {
  agentWrittenFiles.add(filePath);
  setTimeout(() => agentWrittenFiles.delete(filePath), 3000);
}

async function handleFileChange(filePath: string, vaultRoot: string, userId: string): Promise<void> {
  if (agentWrittenFiles.has(filePath)) return;

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return;
  }

  const tasks     = parseAllTaskLines(content);
  const lines     = content.split('\n');
  let   modified  = false;
  const relPath   = path.relative(vaultRoot, filePath);

  for (const task of tasks) {
    const lineIndex = lines.findIndex(l => l === task.rawLine);
    if (lineIndex === -1) continue;

    if (task.checked && task.taskId) {
      // User checked a task → transition to DONE
      const dbTask = await getTaskById(task.taskId);
      if (dbTask && dbTask.status !== 'DONE' && dbTask.status !== 'CANCELLED') {
        await markTaskDone(task.taskId, dbTask.status);
        await logVaultSync('VAULT_TO_DB', relPath, 'TASK', task.taskId, 'UPDATED', { title: task.title, action: 'marked_done' });
      }
    } else if (!task.checked && !task.taskId) {
      // New task without id → create in DB and inject id
      const taskId = await createTask(
        userId,
        task.title,
        task.dueDate,
        null,
        task.priority,
        { file: relPath, blockId: `^${Math.random().toString(36).slice(2, 8)}` },
      );
      lines[lineIndex] = injectTaskId(task.rawLine, taskId);
      modified = true;
      await logVaultSync('VAULT_TO_DB', relPath, 'TASK', taskId, 'CREATED', { title: task.title });
    }
  }

  if (modified) {
    // Rewrite the file with injected IDs
    markAgentWrite(filePath);
    await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
  }
}

export function startVaultWatcher(vaultRoot: string, userId: string): FSWatcher {
  const apppDir    = path.join(vaultRoot, 'APPP');
  const inboxFile  = path.join(apppDir, '00-Inbox.md');
  const projectsGlob = path.join(apppDir, 'Proyectos', '**', '*.md');

  const watcher = watch([inboxFile, projectsGlob], {
    ignoreInitial: false,
    persistent:    true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher.on('add',    fp => { void handleFileChange(fp, vaultRoot, userId); });
  watcher.on('change', fp => { void handleFileChange(fp, vaultRoot, userId); });

  return watcher;
}
