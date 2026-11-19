// One shared connection pool to PostgreSQL (Neon).
const { Pool, types } = require('pg');
const env = require('../config/env');

// By default `pg` returns BIGINT (our ids) as text like "12". Turn them into real numbers so that
// comparisons like `user.id === targetId` work. (Our ids will never get near the 9-quadrillion limit.)
types.setTypeParser(20, (value) => parseInt(value, 10));

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,                          // Neon free tier has limited connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,  // Neon can take a few seconds to wake up
});

pool.on('error', (err) => console.error('Unexpected DB pool error:', err.message));

// Simple query helper. ALWAYS pass user input through `params` ($1, $2 ...), never inside `text`.
const query = (text, params) => pool.query(text, params);

// Run several queries as ONE all-or-nothing unit.
// If the callback throws, everything is rolled back.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
