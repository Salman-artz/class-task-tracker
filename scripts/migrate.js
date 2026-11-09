const fs = require('fs');
const path = require('path');
const db = require('../src/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.query(sql);
  console.log('Migrasi selesai.');
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Migrasi gagal:', err.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = main;
