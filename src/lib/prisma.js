// Single shared PrismaClient for the whole process.
//
// Why this file exists: every `new PrismaClient()` opens its OWN connection pool,
// sized `num_cpus * 2 + 1` by default — and the engine reads num_cpus from
// /proc/cpuinfo, which inside a container reports the HOST's core count, not the
// container's quota. Seven module-level clients were therefore holding 100+
// Supabase pooler connections at idle and exhausting the pooler. One client, one
// pool, sized explicitly via `connection_limit` in DATABASE_URL.
//
// Import this instead of constructing a client:  const prisma = require('../lib/prisma');

const { PrismaClient } = require('@prisma/client');

// Reuse across module reloads (nodemon / jest module registry resets) so a restart
// doesn't strand the previous pool's connections on the pooler.
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__wogPrisma || new PrismaClient();
if (!globalForPrisma.__wogPrisma) globalForPrisma.__wogPrisma = prisma;

module.exports = prisma;
