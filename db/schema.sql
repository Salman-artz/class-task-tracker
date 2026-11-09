
CREATE TABLE IF NOT EXISTS classes (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(10)  NOT NULL CHECK (role IN ('teacher', 'student')),
  class_id      INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- siswa wajib punya kelas
  CONSTRAINT student_has_class CHECK (role <> 'student' OR class_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(150) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date    TIMESTAMPTZ NOT NULL,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_class_due ON tasks (class_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks (created_by);

CREATE TABLE IF NOT EXISTS task_completions (
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_completions_student ON task_completions (student_id);
