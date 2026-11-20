// Reads and checks environment variables. If something is wrong, the server refuses to start
// (better than failing later in a confusing way).
require('dotenv').config({ quiet: true });

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 4000,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  CARD_ENCRYPTION_KEY: process.env.CARD_ENCRYPTION_KEY,
  AUTH_PROVIDER: process.env.AUTH_PROVIDER || 'google',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER || 'mock',
  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
  IMAGE_CHECK_PROVIDER: process.env.IMAGE_CHECK_PROVIDER || 'mock',
};

const problems = [];
if (!env.DATABASE_URL) problems.push('DATABASE_URL is missing');
if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) problems.push('JWT_SECRET is missing or shorter than 16 characters');
if (!/^[0-9a-fA-F]{64}$/.test(env.CARD_ENCRYPTION_KEY || '')) {
  problems.push('CARD_ENCRYPTION_KEY must be exactly 64 hex characters');
}
if (!['mock', 'google'].includes(env.AUTH_PROVIDER)) problems.push('AUTH_PROVIDER must be "mock" or "google"');
if (env.AUTH_PROVIDER === 'google' && !env.GOOGLE_CLIENT_ID) problems.push('GOOGLE_CLIENT_ID is required when AUTH_PROVIDER=google');
if (env.NODE_ENV === 'production' && env.AUTH_PROVIDER === 'mock') {
  problems.push('AUTH_PROVIDER=mock is not allowed in production (anyone could log in as anyone)');
}
if (!['mock', 'cloudinary'].includes(env.STORAGE_PROVIDER)) problems.push('STORAGE_PROVIDER must be "mock" or "cloudinary"');
if (env.STORAGE_PROVIDER === 'cloudinary' && !process.env.CLOUDINARY_URL) {
  problems.push('CLOUDINARY_URL is required when STORAGE_PROVIDER=cloudinary');
}

if (!['mock'].includes(env.IMAGE_CHECK_PROVIDER)) problems.push('IMAGE_CHECK_PROVIDER must be "mock"');

if (problems.length) {
  console.error('\nEnvironment problems:\n - ' + problems.join('\n - ') + '\n');
  throw new Error('Invalid environment configuration');
}

module.exports = env;
