const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const config = require('../config');
const db = require('../db');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { badRequest, conflict, forbidden, unauthorized } = require('../errors');

const router = express.Router();
const BCRYPT_ROUNDS = 12;
// Hash palsu agar waktu respons login tetap mirip walau email tidak ada (cegah user enumeration).
const DUMMY_HASH = bcrypt.hashSync('dummy-password', BCRYPT_ROUNDS);

const registerSchema = z
  .object({
    name: z.string().trim().min(1, 'Nama wajib diisi').max(100),
    email: z.string().trim().toLowerCase().email('Format email tidak valid').max(255),
    password: z
      .string()
      .min(8, 'Password minimal 8 karakter')
      .max(72, 'Password maksimal 72 karakter')
      .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password harus mengandung huruf dan angka'),
    role: z.enum(['teacher', 'student'], { message: "Role harus 'teacher' atau 'student'" }),
    class_id: z.number().int().positive().optional(),
    invite_code: z.string().optional(),
  })
  .strict();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Format email tidak valid'),
  password: z.string().min(1, 'Password wajib diisi').max(72),
});

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, class_id: u.class_id });

router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password, role, class_id, invite_code } = req.valid.body;

    if (role === 'teacher') {
      // Tanpa ini siapa pun bisa mendaftar sebagai guru dan membuat/menghapus tugas.
      if (!invite_code || !safeEqual(invite_code, config.teacherInviteCode)) {
        throw forbidden('Kode undangan guru salah atau belum diisi');
      }
    } else {
      if (!class_id) throw badRequest('Input tidak valid', [{ field: 'class_id', message: 'Siswa wajib memilih kelas' }]);
      const cls = await db.query('SELECT 1 FROM classes WHERE id = $1', [class_id]);
      if (!cls.rowCount) throw badRequest('Input tidak valid', [{ field: 'class_id', message: 'Kelas tidak ditemukan' }]);
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    let user;
    try {
      const { rows } = await db.query(
        `INSERT INTO users (name, email, password_hash, role, class_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, role, class_id`,
        [name, email, passwordHash, role, role === 'student' ? class_id : null]
      );
      user = rows[0];
    } catch (err) {
      if (err.code === '23505') throw conflict('Email sudah terdaftar'); // unique_violation
      throw err;
    }
    res.status(201).json({ data: { user: publicUser(user), token: signToken(user) } });
  } catch (err) {
    next(err);
  }
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.valid.body;
    const { rows } = await db.query(
      'SELECT id, name, email, role, class_id, password_hash FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Email atau password salah');
    res.json({ data: { user: publicUser(user), token: signToken(user) } });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ data: { user: publicUser(req.user) } });
});

module.exports = router;
