const express = require('express');
const { z } = require('zod');
const db = require('../db');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { badRequest, forbidden, notFound } = require('../errors');

const router = express.Router();
router.use(authenticate);

const idParams = z.object({ id: z.coerce.number().int().positive('ID tidak valid') });

const taskBody = z
  .object({
    title: z.string().trim().min(1, 'Judul wajib diisi').max(150, 'Judul maksimal 150 karakter'),
    description: z.string().trim().max(5000, 'Deskripsi maksimal 5000 karakter').default(''),
    due_date: z.string().datetime({ offset: true, message: 'Tenggat harus berformat ISO 8601, mis. 2026-12-01T10:00:00Z' }),
    class_id: z.number({ message: 'class_id wajib berupa angka' }).int().positive(),
  })
  .strict();

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['done', 'pending'], { message: "status harus 'done' atau 'pending'" }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// Escape karakter spesial LIKE agar "50%" dicari apa adanya, bukan sebagai wildcard.
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const SELECT_TASK = `
  SELECT t.id, t.title, t.description, t.due_date, t.class_id, c.name AS class_name,
         t.created_by, t.created_at, t.updated_at`;

// ---------- GET /api/tasks ----------
router.get('/', validate(listQuery, 'query'), async (req, res, next) => {
  try {
    const { search, status, page, limit } = req.valid.query;
    const user = req.user;
    const params = [];
    const where = [];
    const add = (v) => (params.push(v), `$${params.length}`);

    let extraCols = '';
    if (user.role === 'student') {
      where.push(`t.class_id = ${add(user.class_id)}`);
      const me = add(user.id);
      extraCols = `, EXISTS (SELECT 1 FROM task_completions tc WHERE tc.task_id = t.id AND tc.student_id = ${me}) AS completed`;
      const doneExpr = `EXISTS (SELECT 1 FROM task_completions tc WHERE tc.task_id = t.id AND tc.student_id = ${me})`;
      if (status === 'done') where.push(doneExpr);
      if (status === 'pending') where.push(`NOT ${doneExpr}`);
    } else {
      if (status) throw badRequest('Input tidak valid', [{ field: 'status', message: 'Filter status hanya untuk siswa' }]);
      where.push(`t.created_by = ${add(user.id)}`);
      extraCols = `, (SELECT COUNT(*)::int FROM task_completions tc WHERE tc.task_id = t.id) AS completed_count,
                    (SELECT COUNT(*)::int FROM users s WHERE s.role = 'student' AND s.class_id = t.class_id) AS student_count`;
    }
    if (search) where.push(`t.title ILIKE ${add(`%${escapeLike(search)}%`)} ESCAPE '\\'`);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM tasks t ${whereSql}`, params);
    const total = countRes.rows[0].total;

    const limitP = add(limit);
    const offsetP = add((page - 1) * limit);
    const { rows } = await db.query(
      `${SELECT_TASK}${extraCols}
       FROM tasks t JOIN classes c ON c.id = t.class_id
       ${whereSql}
       ORDER BY t.due_date ASC, t.id ASC
       LIMIT ${limitP} OFFSET ${offsetP}`,
      params
    );
    res.json({ data: rows, meta: { page, limit, total, total_pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

// ---------- helper ----------
async function findTask(id) {
  const { rows } = await db.query(
    `${SELECT_TASK} FROM tasks t JOIN classes c ON c.id = t.class_id WHERE t.id = $1`,
    [id]
  );
  return rows[0];
}

async function assertClassExists(classId) {
  const { rowCount } = await db.query('SELECT 1 FROM classes WHERE id = $1', [classId]);
  if (!rowCount) throw badRequest('Input tidak valid', [{ field: 'class_id', message: 'Kelas tidak ditemukan' }]);
}

// ---------- GET /api/tasks/:id ----------
router.get('/:id', validate(idParams, 'params'), async (req, res, next) => {
  try {
    const task = await findTask(req.valid.params.id);
    const u = req.user;
    // Siswa di luar kelas dan guru lain mendapat 404 (tidak membocorkan keberadaan tugas).
    if (!task || (u.role === 'student' ? task.class_id !== u.class_id : task.created_by !== u.id)) {
      throw notFound('Tugas tidak ditemukan');
    }
    if (u.role === 'student') {
      const c = await db.query('SELECT 1 FROM task_completions WHERE task_id = $1 AND student_id = $2', [task.id, u.id]);
      task.completed = c.rowCount > 0;
    }
    res.json({ data: task });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/tasks (guru) ----------
router.post('/', requireRole('teacher'), validate(taskBody), async (req, res, next) => {
  try {
    const b = req.valid.body;
    await assertClassExists(b.class_id);
    const { rows } = await db.query(
      `INSERT INTO tasks (title, description, due_date, class_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [b.title, b.description, b.due_date, b.class_id, req.user.id]
    );
    res.status(201).json({ data: await findTask(rows[0].id) });
  } catch (err) {
    next(err);
  }
});

// Guru hanya boleh mengubah/menghapus tugas buatannya sendiri.
async function loadOwnedTask(req, _res, next) {
  try {
    const task = await findTask(req.valid.params.id);
    if (!task) throw notFound('Tugas tidak ditemukan');
    if (task.created_by !== req.user.id) throw forbidden('Anda hanya boleh mengelola tugas buatan Anda sendiri');
    req.task = task;
    next();
  } catch (err) {
    next(err);
  }
}

// ---------- PUT /api/tasks/:id (guru) ----------
router.put('/:id', requireRole('teacher'), validate(idParams, 'params'), validate(taskBody), loadOwnedTask, async (req, res, next) => {
  try {
    const b = req.valid.body;
    await assertClassExists(b.class_id);
    await db.query(
      `UPDATE tasks SET title = $1, description = $2, due_date = $3, class_id = $4, updated_at = now()
       WHERE id = $5`,
      [b.title, b.description, b.due_date, b.class_id, req.task.id]
    );
    res.json({ data: await findTask(req.task.id) });
  } catch (err) {
    next(err);
  }
});

// ---------- DELETE /api/tasks/:id (guru) ----------
router.delete('/:id', requireRole('teacher'), validate(idParams, 'params'), loadOwnedTask, async (req, res, next) => {
  try {
    await db.query('DELETE FROM tasks WHERE id = $1', [req.task.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------- POST/DELETE /api/tasks/:id/complete (siswa) ----------
async function loadTaskForStudent(req, _res, next) {
  try {
    const task = await findTask(req.valid.params.id);
    if (!task || task.class_id !== req.user.class_id) throw notFound('Tugas tidak ditemukan');
    req.task = task;
    next();
  } catch (err) {
    next(err);
  }
}

router.post('/:id/complete', requireRole('student'), validate(idParams, 'params'), loadTaskForStudent, async (req, res, next) => {
  try {
    // Idempoten: klik dua kali tidak membuat data ganda (PRIMARY KEY task_id + student_id).
    await db.query(
      'INSERT INTO task_completions (task_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.task.id, req.user.id]
    );
    res.json({ data: { task_id: req.task.id, completed: true } });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/complete', requireRole('student'), validate(idParams, 'params'), loadTaskForStudent, async (req, res, next) => {
  try {
    await db.query('DELETE FROM task_completions WHERE task_id = $1 AND student_id = $2', [req.task.id, req.user.id]);
    res.json({ data: { task_id: req.task.id, completed: false } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
