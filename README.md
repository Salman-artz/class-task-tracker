# Class Task Tracker

Aplikasi manajemen tugas kelas: **guru** membuat/mengubah/menghapus tugas, **siswa** melihat tugas kelasnya dan menandai selesai.
Dibuat untuk Tes Kompetensi Fullstack Developer Magang - SchoolTech Indonesia.

## Stack

| Lapisan | Pilihan |
|---|---|
| Backend | Node.js 20+ (diuji di 22), Express 4 |
| Database | PostgreSQL (skrip skema `db/schema.sql`, seeder `scripts/seed.js`) |
| Validasi | zod |
| Auth | JWT (HS256) + password di-hash bcrypt (12 rounds) |
| Frontend | HTML + CSS + JavaScript murni (tanpa build step), dilayani oleh Express dari folder `public/` |
| Test | Jest + Supertest (19 test) |

Nilai tambah yang dipilih (maksimal dua): **(1) feature test**, **(2) tampilan responsif untuk ponsel**.

## Menjalankan dari nol

Prasyarat: Node.js 20+, PostgreSQL 14+.

```bash
# 1. Ambil kode
git clone <URL-REPOSITORI-INI> class-task-tracker
cd class-task-tracker

# 2. Pasang dependensi
npm install

# 3. Siapkan database (sekali saja). Ganti password sesuai keinginan.
psql -U postgres -c "CREATE USER tasks WITH PASSWORD 'ganti_password_ini';"
psql -U postgres -c "CREATE DATABASE class_tasks OWNER tasks;"
psql -U postgres -c "CREATE DATABASE class_tasks_test OWNER tasks;"   # hanya untuk menjalankan test

# 4. Konfigurasi environment
cp .env.example .env
#    lalu edit .env: isi DATABASE_URL (sesuai password di langkah 3), JWT_SECRET (string acak panjang),
#    dan TEACHER_INVITE_CODE (kode rahasia untuk mendaftar sebagai guru)

# 5. Buat tabel dan isi data contoh
npm run setup          # = npm run migrate && npm run seed

# 6. Jalankan
npm start              # buka http://localhost:3000
```

Menjalankan test (memakai database `class_tasks_test`, tidak menyentuh data asli):

```bash
npm test
```

> `npm run seed` **menghapus semua data** di tabel aplikasi lalu mengisi ulang data contoh. Seeder menolak berjalan jika `NODE_ENV=production`.

## Akun contoh (dari seeder)

| Peran | Email | Password | Kelas |
|---|---|---|---|
| Guru | `guru@example.test` | `Guru12345` | membuat tugas X-A |
| Guru | `guru2@example.test` | `Guru12345` | membuat tugas X-B |
| Siswa | `siswa1@example.test` | `Siswa12345` | X-A |
| Siswa | `siswa2@example.test` | `Siswa12345` | X-A |
| Siswa | `siswa3@example.test` | `Siswa12345` | X-B |

Akun di atas hanya data contoh untuk pengembangan. Untuk mendaftar sebagai guru lewat form, dibutuhkan `TEACHER_INVITE_CODE` dari file `.env` Anda.

## Endpoint

Semua respons sukses berbentuk `{ "data": ..., "meta": ... }`. Semua error berbentuk
`{ "error": { "code": "...", "message": "...", "details": [...] } }`.

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| GET | `/api/health` | publik | cek server |
| GET | `/api/classes` | publik | daftar kelas (untuk form registrasi) |
| POST | `/api/auth/register` | publik | daftar `student` (butuh `class_id`) atau `teacher` (butuh `invite_code`) |
| POST | `/api/auth/login` | publik | mengembalikan `{ user, token }` |
| GET | `/api/auth/me` | login | profil pengguna saat ini |
| GET | `/api/tasks` | login | query: `search`, `status` (`done` atau `pending`, khusus siswa), `page`, `limit` (maks. 50). Siswa: tugas kelasnya. Guru: tugas buatannya + jumlah siswa yang selesai |
| GET | `/api/tasks/:id` | login | detail (siswa: hanya kelasnya; guru: hanya miliknya, selain itu 404) |
| POST | `/api/tasks` | guru | `{ title, description?, due_date (ISO 8601), class_id }` -> 201 |
| PUT | `/api/tasks/:id` | guru pemilik | ubah tugas |
| DELETE | `/api/tasks/:id` | guru pemilik | hapus tugas -> 204 |
| POST | `/api/tasks/:id/complete` | siswa | tandai selesai (idempoten) |
| DELETE | `/api/tasks/:id/complete` | siswa | batalkan tanda selesai |

Kode status yang dipakai: 200, 201, 204, 400 (validasi/JSON rusak), 401 (belum login/token salah), 403 (peran/kepemilikan salah), 404, 409 (email duplikat), 413, 429 (rate limit), 500.

## Keputusan desain

- **Otorisasi dicek di server, bukan hanya disembunyikan di UI.** Siswa yang memanggil `POST/PUT/DELETE /api/tasks` langsung mendapat 403 (ada test-nya). Guru hanya bisa mengubah/menghapus tugas **buatannya sendiri**.
- **Pendaftaran guru memakai kode undangan.** Tanpa itu, siapa pun bisa memilih peran guru saat registrasi dan menguasai fitur guru. Kode disimpan di `.env`, dibandingkan dengan `timingSafeEqual`.
- **Tidak membocorkan keberadaan data.** Tugas kelas lain atau milik guru lain dijawab 404, bukan 403.
- **Login memberi pesan generik** ("Email atau password salah") dan tetap menjalankan `bcrypt.compare` walau email tidak ada, supaya tidak bisa dipakai menebak email terdaftar.
- **Query selalu berparameter** (`$1, $2, ...`), dan karakter `%` / `_` pada pencarian di-escape agar dicari apa adanya.
- **"Selesai" disimpan per siswa** di tabel `task_completions` (PK gabungan `task_id + student_id`), karena satu tugas dikerjakan banyak siswa. PK gabungan sekaligus mencegah data ganda jika tombol diklik dua kali.
- **Token disimpan di `sessionStorage`** (hilang saat tab ditutup), dikirim lewat header `Authorization: Bearer`. Seluruh teks dari server dirender dengan `textContent`, dan `helmet` memasang CSP yang hanya mengizinkan skrip dari origin sendiri, untuk mengurangi risiko XSS. Risiko pencurian token lewat XSS tetap ada pada pendekatan ini; alternatifnya cookie `httpOnly` + proteksi CSRF.
- **Rate limit** 30 percobaan / 15 menit pada `/api/auth/*`, batas body JSON 50 KB, dan detail error 500 hanya ditulis ke log server (tidak dikirim ke klien).
- Frontend dilayani oleh Express (satu origin) sehingga CORS tidak diperlukan; `CORS_ORIGIN` opsional jika frontend dipisah.

## Belum selesai / akan diperbaiki jika ada waktu tambahan

- Belum ada Dockerfile/docker-compose, dokumentasi OpenAPI/Swagger, dan notifikasi tenggat (di luar dua nilai tambah yang dipilih).
- Belum ada relasi "guru wali kelas" / "guru pengampu": setiap guru bisa membuat tugas untuk kelas mana pun (tetap hanya mengelola tugas buatannya sendiri).
- Belum ada fitur lupa password, verifikasi email, dan pencabutan token (logout hanya menghapus token di sisi klien; token kedaluwarsa dalam 2 jam).
- Migrasi masih satu berkas skema idempoten, belum alat migrasi berversi (mis. node-pg-migrate).
- Frontend belum punya test otomatis (hanya API yang diuji); pengujian UI dilakukan manual.
- Paginasi memakai `OFFSET`; untuk data sangat besar sebaiknya keyset pagination.

## Penggunaan alat AI

> Bagian ini wajib sesuai petunjuk tes.

- **Dibantu AI (Claude, Anthropic):** perancangan struktur proyek, penulisan awal backend (rute, validasi, middleware), skema SQL, seeder, frontend, 19 feature test, dan README ini.
- **Yang saya periksa dan ubah sendiri:** *(ISI SEBELUM DIKUMPULKAN. Tuliskan dengan jujur bagian yang Anda baca ulang, jalankan, ubah, atau perbaiki sendiri.)*

## Struktur folder

```
db/schema.sql          skema tabel
scripts/migrate.js     menjalankan skema
scripts/seed.js        data contoh
src/app.js             konfigurasi Express (helmet, rate limit, rute)
src/routes/            auth, classes, tasks
src/middleware/        auth (JWT), validate (zod), errorHandler
tests/api.test.js      feature test (Jest + Supertest)
public/                frontend (index.html, app.js, styles.css)
```
