// Runs before every test file. Sets safe test settings.
// Integration tests need TEST_DATABASE_URL (a database whose name contains "test"), because they DELETE data.
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://unused:unused@localhost:5432/unused_test';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.CARD_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.AUTH_PROVIDER = 'mock';
process.env.STORAGE_PROVIDER = 'mock';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'harvestx-test-uploads');
process.env.RATE_LIMIT_MAX = '100000';
process.env.RATE_LIMIT_AUTH_MAX = '100000';
