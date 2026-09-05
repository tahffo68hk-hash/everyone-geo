// Read-only fingerprint of the original business tables. No row values are printed.
const { createHash } = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const client = new PrismaClient();
(async () => {
  const snapshot = {};
  for (const table of ['User', 'Organization', 'OrganizationMember', 'Project', 'Brand', 'Competitor', 'QuerySet', 'Query']) {
    const rows = await client.$queryRawUnsafe(`SELECT row_to_json(t)::text AS row FROM "${table}" t ORDER BY id`);
    snapshot[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  }
  console.log(JSON.stringify(snapshot, null, 2));
})().catch(() => { console.error('Database snapshot failed'); process.exitCode = 1; }).finally(() => client.$disconnect());
