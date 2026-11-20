// Runs ONCE before all tests: rebuilds the test database from supabase_shim.sql + every file in ../migrations.
// TEST_DATABASE_URL must point to a database whose name contains "test" (the shim drops the public schema!).
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

module.exports = async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/test/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must be set and its database name must contain "test"');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(fs.readFileSync(path.join(__dirname, 'supabase_shim.sql'), 'utf8'));
    const dir = path.join(__dirname, '..', 'migrations');
    for (const f of fs.readdirSync(dir).filter((n) => /^\d+_.+\.sql$/.test(n)).sort()) {
      try { await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { throw new Error(`Migration ${f} failed: ${e.message}`); }
    }
  } finally { await c.end(); }
};
