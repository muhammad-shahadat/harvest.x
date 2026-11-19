// Adds an email to the staff list. That person becomes admin/operator the next time they log in with Google.
// Usage:  npm run seed:staff -- someone@gmail.com admin
//         npm run seed:staff -- driver@gmail.com operator
const { pool } = require('../src/db/pool');

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const role = process.argv[3] || 'admin';
  if (!email.includes('@') || !['admin', 'operator'].includes(role)) {
    console.error('Usage: npm run seed:staff -- <email> <admin|operator>');
    process.exit(1);
  }
  await pool.query(
    `INSERT INTO staff_allowlist (email, role) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role`, [email, role]);
  console.log(`OK: ${email} will be "${role}" after their next Google login.`);
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
