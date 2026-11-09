const express = require('express');
const db = require('../db');

const router = express.Router();

// Publik: dibutuhkan form registrasi untuk memilih kelas. Hanya id dan nama.
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await db.query('SELECT id, name FROM classes ORDER BY name');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
