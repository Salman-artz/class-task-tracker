const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden } = require('../errors');

// Verifikasi JWT, lalu ambil user terbaru dari DB (token dari user yang sudah dihapus otomatis ditolak).
async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw unauthorized('Token tidak valid atau sudah kedaluwarsa');
    }

    const { rows } = await db.query(
      'SELECT id, name, email, role, class_id FROM users WHERE id = $1',
      [payload.sub]
    );
    if (!rows[0]) throw unauthorized('Pengguna tidak ditemukan');
    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

const requireRole = (role) => (req, _res, next) =>
  req.user.role === role ? next() : next(forbidden(`Hanya ${role === 'teacher' ? 'guru' : 'siswa'} yang boleh melakukan ini`));

module.exports = { authenticate, requireRole };
