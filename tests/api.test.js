const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const migrate = require('../scripts/migrate');

const INVITE = process.env.TEACHER_INVITE_CODE;
const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

let classA;
let classB;
let teacherToken;
let teacher2Token;
let studentToken;
let student2Token;
let taskId;

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function register(body) {
  return request(app).post('/api/auth/register').send(body);
}

beforeAll(async () => {
  await migrate();
  await db.query('TRUNCATE task_completions, tasks, users, classes RESTART IDENTITY CASCADE');
  const { rows } = await db.query("INSERT INTO classes (name) VALUES ('A'), ('B') RETURNING id");
  [classA, classB] = rows.map((r) => r.id);

  teacherToken = (await register({ name: 'Guru', email: 'g1@t.test', password: 'Passw0rdOK', role: 'teacher', invite_code: INVITE })).body.data.token;
  teacher2Token = (await register({ name: 'Guru2', email: 'g2@t.test', password: 'Passw0rdOK', role: 'teacher', invite_code: INVITE })).body.data.token;
  studentToken = (await register({ name: 'Siswa', email: 's1@t.test', password: 'Passw0rdOK', role: 'student', class_id: classA })).body.data.token;
  student2Token = (await register({ name: 'Siswa B', email: 's2@t.test', password: 'Passw0rdOK', role: 'student', class_id: classB })).body.data.token;
});

afterAll(() => db.pool.end());

describe('Auth', () => {
  test('registrasi: password di-hash, bukan teks biasa', async () => {
    const { rows } = await db.query("SELECT password_hash FROM users WHERE email = 's1@t.test'");
    expect(rows[0].password_hash).not.toContain('Passw0rdOK');
    expect(rows[0].password_hash.startsWith('$2')).toBe(true);
  });

  test('registrasi guru tanpa kode undangan ditolak (403)', async () => {
    const res = await register({ name: 'X', email: 'x@t.test', password: 'Passw0rdOK', role: 'teacher' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('registrasi dengan input tidak valid -> 400 + detail', async () => {
    const res = await register({ name: '', email: 'bukan-email', password: '123', role: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  test('email duplikat -> 409', async () => {
    const res = await register({ name: 'Siswa', email: 'S1@t.test', password: 'Passw0rdOK', role: 'student', class_id: classA });
    expect(res.status).toBe(409);
  });

  test('login benar -> 200 + token; salah -> 401 pesan generik', async () => {
    const ok = await request(app).post('/api/auth/login').send({ email: 's1@t.test', password: 'Passw0rdOK' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.token).toBeTruthy();
    expect(ok.body.data.user.password_hash).toBeUndefined();

    const bad = await request(app).post('/api/auth/login').send({ email: 's1@t.test', password: 'salahbanget1' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nope@t.test', password: 'salahbanget1' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
  });

  test('endpoint terproteksi tanpa token -> 401', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });
});

describe('Tugas - hak akses guru vs siswa', () => {
  test('guru membuat tugas -> 201', async () => {
    const res = await request(app).post('/api/tasks').set(auth(teacherToken)).send({
      title: 'Tugas 100% Aljabar', description: 'Kerjakan', due_date: future(3), class_id: classA,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Tugas 100% Aljabar');
    taskId = res.body.data.id;
  });

  test('validasi: tenggat bukan tanggal & kelas tidak ada -> 400', async () => {
    const r1 = await request(app).post('/api/tasks').set(auth(teacherToken)).send({ title: 'x', due_date: 'besok', class_id: classA });
    expect(r1.status).toBe(400);
    const r2 = await request(app).post('/api/tasks').set(auth(teacherToken)).send({ title: 'x', due_date: future(1), class_id: 9999 });
    expect(r2.status).toBe(400);
  });

  test('siswa TIDAK boleh membuat/mengubah/menghapus tugas (403)', async () => {
    const body = { title: 'Hack', description: '', due_date: future(1), class_id: classA };
    expect((await request(app).post('/api/tasks').set(auth(studentToken)).send(body)).status).toBe(403);
    expect((await request(app).put(`/api/tasks/${taskId}`).set(auth(studentToken)).send(body)).status).toBe(403);
    expect((await request(app).delete(`/api/tasks/${taskId}`).set(auth(studentToken))).status).toBe(403);
  });

  test('guru lain tidak boleh mengubah/menghapus tugas guru pertama (403)', async () => {
    const body = { title: 'Ubah', description: '', due_date: future(1), class_id: classA };
    expect((await request(app).put(`/api/tasks/${taskId}`).set(auth(teacher2Token)).send(body)).status).toBe(403);
    expect((await request(app).delete(`/api/tasks/${taskId}`).set(auth(teacher2Token))).status).toBe(403);
  });

  test('siswa kelas lain tidak melihat / tidak bisa menandai tugas (404)', async () => {
    expect((await request(app).get(`/api/tasks/${taskId}`).set(auth(student2Token))).status).toBe(404);
    expect((await request(app).post(`/api/tasks/${taskId}/complete`).set(auth(student2Token))).status).toBe(404);
    const list = await request(app).get('/api/tasks').set(auth(student2Token));
    expect(list.body.data).toHaveLength(0);
  });

  test('guru tidak boleh menandai selesai (403)', async () => {
    expect((await request(app).post(`/api/tasks/${taskId}/complete`).set(auth(teacherToken))).status).toBe(403);
  });

  test('ID tidak valid -> 400, ID tidak ada -> 404', async () => {
    expect((await request(app).get('/api/tasks/abc').set(auth(studentToken))).status).toBe(400);
    expect((await request(app).get('/api/tasks/999999').set(auth(studentToken))).status).toBe(404);
  });
});

describe('Tandai selesai, pencarian, filter, paginasi', () => {
  test('siswa menandai selesai dua kali -> tetap satu baris (idempoten)', async () => {
    expect((await request(app).post(`/api/tasks/${taskId}/complete`).set(auth(studentToken))).status).toBe(200);
    expect((await request(app).post(`/api/tasks/${taskId}/complete`).set(auth(studentToken))).status).toBe(200);
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM task_completions WHERE task_id = $1', [taskId]);
    expect(rows[0].n).toBe(1);
  });

  test('filter status done/pending dan pencarian judul (termasuk karakter %)', async () => {
    await request(app).post('/api/tasks').set(auth(teacherToken)).send({ title: 'Esai Sejarah', description: '', due_date: future(5), class_id: classA });

    const done = await request(app).get('/api/tasks?status=done').set(auth(studentToken));
    expect(done.body.data.map((t) => t.title)).toEqual(['Tugas 100% Aljabar']);
    const pending = await request(app).get('/api/tasks?status=pending').set(auth(studentToken));
    expect(pending.body.data.map((t) => t.title)).toEqual(['Esai Sejarah']);

    const s1 = await request(app).get('/api/tasks?search=esai').set(auth(studentToken));
    expect(s1.body.data).toHaveLength(1);
    const s2 = await request(app).get('/api/tasks').query({ search: '100%' }).set(auth(studentToken));
    expect(s2.body.data).toHaveLength(1);
    const s3 = await request(app).get('/api/tasks').query({ search: '%' }).set(auth(studentToken));
    expect(s3.body.data).toHaveLength(1); // '%' dicari harfiah, bukan wildcard
  });

  test('paginasi + meta; limit tidak valid -> 400', async () => {
    for (let i = 1; i <= 4; i++) {
      await request(app).post('/api/tasks').set(auth(teacherToken)).send({ title: `Bulk ${i}`, description: '', due_date: future(10 + i), class_id: classA });
    }
    const p1 = await request(app).get('/api/tasks?limit=2&page=1').set(auth(teacherToken));
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta).toMatchObject({ page: 1, limit: 2, total: 6, total_pages: 3 });
    const p3 = await request(app).get('/api/tasks?limit=2&page=3').set(auth(teacherToken));
    expect(p3.body.data).toHaveLength(2);
    expect((await request(app).get('/api/tasks?limit=1000').set(auth(teacherToken))).status).toBe(400);
  });

  test('guru mengubah lalu menghapus tugasnya sendiri', async () => {
    const put = await request(app).put(`/api/tasks/${taskId}`).set(auth(teacherToken)).send({ title: 'Judul Baru', description: 'd', due_date: future(4), class_id: classA });
    expect(put.status).toBe(200);
    expect(put.body.data.title).toBe('Judul Baru');
    expect((await request(app).delete(`/api/tasks/${taskId}`).set(auth(teacherToken))).status).toBe(204);
    expect((await request(app).get(`/api/tasks/${taskId}`).set(auth(teacherToken))).status).toBe(404);
  });
});

describe('Keamanan dasar', () => {
  test('SQL injection di parameter search diperlakukan sebagai teks', async () => {
    const res = await request(app).get('/api/tasks').query({ search: "' OR 1=1 --" }).set(auth(studentToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('JSON rusak -> 400 format error seragam; rute API tak dikenal -> 404 JSON', async () => {
    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{rusak');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    const nf = await request(app).get('/api/tidak-ada');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
  });
});
