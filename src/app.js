const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
app.use(helmet()); // CSP bawaan helmet: skrip hanya dari origin sendiri (mengurangi dampak XSS)
if (config.corsOrigin) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
}
app.use(express.json({ limit: '50kb' }));

app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));

// Batasi percobaan login/registrasi (anti brute force). Dimatikan saat test.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isTest,
  message: { error: { code: 'RATE_LIMITED', message: 'Terlalu banyak percobaan, coba lagi nanti' } },
});

app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api', notFoundHandler);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(errorHandler);

module.exports = app;
