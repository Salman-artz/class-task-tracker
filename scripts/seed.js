// Data contoh untuk pengembangan/penilaian. MENGHAPUS semua data lama di tabel aplikasi.
const bcrypt = require('bcryptjs');
const db = require('../src/db');

const TEACHER_PASSWORD = '1234567';
const STUDENT_PASSWORD = '1234567';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Seeder tidak boleh dijalankan di production');

  await db.query('TRUNCATE task_completions, tasks, users, classes RESTART IDENTITY CASCADE');

  const { rows: classes } = await db.query(
    "INSERT INTO classes (name) VALUES ('X-A'), ('X-B') RETURNING id, name"
  );
  const [xa, xb] = classes;

  const tHash = await bcrypt.hash(TEACHER_PASSWORD, 12);
  const sHash = await bcrypt.hash(STUDENT_PASSWORD, 12);

  const { rows: teachers } = await db.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES
       ('Bu Rina (Guru)', 'guru@guru.test', $1, 'teacher'),
       ('Pak Budi (Guru)', 'guru2@guru.test', $1, 'teacher')
     RETURNING id`,
    [tHash]
  );
  const { rows: students } = await db.query(
    `INSERT INTO users (name, email, password_hash, role, class_id) VALUES
       ('Andi (Siswa X-A)', 'siswa1@siswa.test', $1, 'student', $2),
       ('Sari (Siswa X-A)', 'siswa2@siswa.test', $1, 'student', $2),
       ('Dewi (Siswa X-B)', 'siswa3@siswa.test', $1, 'student', $3)
     RETURNING id`,
    [sHash, xa.id, xb.id]
  );

  const day = 24 * 3600 * 1000;
  const due = (d) => new Date(Date.now() + d * day).toISOString();
  const taskRows = [
    ['Latihan Soal Aljabar Bab 1', 'Kerjakan soal nomor 1-20 di buku paket.', due(2), xa.id, teachers[0].id],
    ['Laporan Praktikum Fisika', 'Tulis laporan percobaan gerak lurus (maks. 3 halaman).', due(5), xa.id, teachers[0].id],
    ['Esai Sejarah Kemerdekaan', 'Esai 500 kata tentang proklamasi 1945.', due(7), xa.id, teachers[0].id],
    ['Hafalan Rumus Trigonometri', 'Hafalkan sin, cos, tan sudut istimewa.', due(-1), xa.id, teachers[0].id],
    ['Proyek Poster Biologi', 'Buat poster tentang ekosistem lokal.', due(10), xb.id, teachers[1].id],
    ['Kuis Bahasa Inggris Unit 3', 'Persiapan kuis tentang simple past tense.', due(3), xb.id, teachers[1].id],
  ];
  const ids = [];
  for (const t of taskRows) {
    const { rows } = await db.query(
      'INSERT INTO tasks (title, description, due_date, class_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      t
    );
    ids.push(rows[0].id);
  }
  // Andi sudah menyelesaikan satu tugas.
  await db.query('INSERT INTO task_completions (task_id, student_id) VALUES ($1, $2)', [ids[3], students[0].id]);

  console.log('Seeder selesai.');
  console.log('Akun contoh -> guru: guru@guru.test / %s ; siswa: siswa1@siswa.test / %s', TEACHER_PASSWORD, STUDENT_PASSWORD);
}

main()
  .catch((err) => {
    console.error('Seeder gagal:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
