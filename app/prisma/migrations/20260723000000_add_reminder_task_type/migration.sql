-- Add REMINDER to tasks.task_type check constraint
ALTER TABLE tasks DROP CONSTRAINT tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type = ANY (ARRAY[
    'EMAIL_SEND','REPORT','PHONE_CALL','MEETING',
    'DEADLINE','AGREEMENT','PROJECT_MILESTONE',
    'REMINDER','GENERIC'
  ]));
