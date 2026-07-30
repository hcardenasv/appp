-- Agrega campo de observaciones persistentes a las tareas
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT;
