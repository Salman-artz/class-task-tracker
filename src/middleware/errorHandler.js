const { ApiError } = require('../errors');

function notFoundHandler(req, _res, next) {
  next(new ApiError(404, 'NOT_FOUND', `Rute ${req.method} ${req.originalUrl} tidak ada`));
}

// Format error seragam: { error: { code, message, details? } }
// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
  }
  // body-parser: JSON rusak / terlalu besar
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Body JSON tidak valid' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Body terlalu besar' } });
  }
  console.error(err); // detail hanya di log server, tidak dibocorkan ke klien
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server' } });
}

module.exports = { notFoundHandler, errorHandler };
