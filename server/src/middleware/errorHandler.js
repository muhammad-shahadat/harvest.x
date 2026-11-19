// One place that turns every error into the same JSON shape:
//   { "error": { "code": "SOME_CODE", "message": "...", "details": ... } }
const { AppError } = require('../utils/errors');

function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err && err.name === 'ZodError') {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details } });
  }
  if (err && err.name === 'MulterError') {
    const code = err.code === 'LIMIT_FILE_SIZE' ? 'IMAGE_TOO_LARGE' : 'UPLOAD_ERROR';
    return res.status(400).json({ error: { code, message: err.message } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
  }
  console.error('Unexpected error:', err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}

module.exports = { notFound, errorHandler };
