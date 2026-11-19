// AppError = an error we expect (wrong input, not allowed, not found).
// `code` is an English constant like "FARMER_NOT_APPROVED"; the React app translates it to Bangla/English.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { AppError };
