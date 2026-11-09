const { badRequest } = require('../errors');

// Validasi req[source] dengan skema zod; hasil bersih disimpan di req.valid[source].
module.exports = function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return next(badRequest('Input tidak valid', details));
    }
    req.valid = req.valid || {};
    req.valid[source] = result.data;
    next();
  };
};
