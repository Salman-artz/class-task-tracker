class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new ApiError(400, 'VALIDATION_ERROR', message, details);
const unauthorized = (message = 'Autentikasi diperlukan') => new ApiError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'Anda tidak punya akses ke sumber daya ini') => new ApiError(403, 'FORBIDDEN', message);
const notFound = (message = 'Data tidak ditemukan') => new ApiError(404, 'NOT_FOUND', message);
const conflict = (message) => new ApiError(409, 'CONFLICT', message);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict };
