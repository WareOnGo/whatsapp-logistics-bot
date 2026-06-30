// Read-only Postgres lookups for the assistant.
//
// Security model — "agent proposes, deterministic code disposes":
//   - The agent NEVER writes SQL and NEVER holds DB credentials. It emits a directive
//     [[DATA|q=<named_query>|param=value|...]]; the bot maps the name to a CANNED,
//     parameterized SQL statement and runs it. There is no arbitrary-SQL path.
//   - The connection uses a dedicated least-privilege role (wog_ro): SELECT on only
//     Warehouse + WarehouseData, default_transaction_read_only=on, 5s statement_timeout,
//     and an RLS SELECT policy scoped to that role. Even a buggy/poisoned directive can
//     do nothing but read those two tables.
//
// To add a new lookup: add an entry to QUERIES (and grant the role SELECT on any new
// table + an RLS policy if that table has RLS). Nothing else changes.

const { Pool } = require('pg');

let pool = null;
function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL_RO) {
    console.warn('[dbread] DATABASE_URL_RO not set — DB lookups disabled');
    return null;
  }
  pool = new Pool({
    connectionString: process.env.DATABASE_URL_RO,
    ssl: { rejectUnauthorized: false }, // Supabase pooler requires TLS
    max: 3, // this is a side feature; keep the footprint small
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 5_000, // belt-and-suspenders (the role already enforces this)
  });
  pool.on('error', (e) => console.error('[dbread] pool error:', e.message));
  return pool;
}

// ---- param helpers ---------------------------------------------------------
function reqStr(v, name) {
  const s = (v == null ? '' : String(v)).trim();
  if (!s) throw new Error(`missing required param "${name}"`);
  if (s.length > 80) throw new Error(`param "${name}" too long`);
  return s;
}
function reqInt(v, name) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n)) throw new Error(`param "${name}" must be an integer`);
  return n;
}
function clampInt(v, dflt, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
function truthy(v) {
  return v === true || /^(true|yes|y|1)$/i.test(String(v || ''));
}

// City data is dirty (Bengaluru vs Bangalore, Gurgaon vs Gurugram, ...). Expand a
// user-supplied city to its known aliases and match any of them via ILIKE.
const CITY_ALIASES = {
  bengaluru: ['bengaluru', 'bangalore'], bangalore: ['bengaluru', 'bangalore'],
  gurgaon: ['gurgaon', 'gurugram'], gurugram: ['gurgaon', 'gurugram'],
  delhi: ['delhi', 'new delhi'], 'new delhi': ['delhi', 'new delhi'],
  mumbai: ['mumbai', 'bombay'], bombay: ['mumbai', 'bombay'],
  kolkata: ['kolkata', 'calcutta'], calcutta: ['kolkata', 'calcutta'],
  chennai: ['chennai', 'madras'], madras: ['chennai', 'madras'],
};
function cityPatterns(city) {
  const key = city.trim().toLowerCase();
  const names = CITY_ALIASES[key] || [key];
  return names.map((n) => `%${n}%`);
}

// ---- named query registry --------------------------------------------------
// Each entry: build(args) -> { sql, values }. `desc` is surfaced to the agent so it
// knows what it can ask for and with which params.
const QUERIES = {
  warehouses_by_city: {
    desc: 'List warehouses in a city. Params: city (required), limit (optional, 1-25).',
    build(a) {
      const limit = clampInt(a.limit, 10, 1, 25);
      return {
        sql: `SELECT id, city, zone, "warehouseType" AS type, "ratePerSqft" AS rate,
                     "totalSpaceSqft" AS sqft, availability, "wogVerified" AS verified
                FROM "Warehouse"
               WHERE city ILIKE ANY($1)
            ORDER BY "wogVerified" DESC NULLS LAST, id DESC
               LIMIT $2`,
        values: [cityPatterns(reqStr(a.city, 'city')), limit],
      };
    },
  },

  warehouse_detail: {
    // NOTE: owner contact info (contactPerson / contactNumber / alt phones) is deliberately
    // NOT selected — the assistant never surfaces owner PII. Re-add only if intended.
    desc: 'Full detail of ONE warehouse by its id (address, specs, location). Does NOT include owner contact. Params: id (required).',
    build(a) {
      return {
        sql: `SELECT w.id, w.city, w.state, w.zone, w.address, w."warehouseType" AS type,
                     w."ratePerSqft" AS rate, w."totalSpaceSqft" AS sqft, w."offeredSpaceSqft" AS offered_sqft,
                     w."clearHeightFt" AS clear_height_ft, w."numberOfDocks" AS docks, w.compliances,
                     w.availability, w.status, w."wogVerified" AS verified,
                     wd.latitude, wd.longitude, wd."powerKva" AS power_kva,
                     wd."landType" AS land_type, wd."fireNocAvailable" AS fire_noc
                FROM "Warehouse" w
           LEFT JOIN "WarehouseData" wd ON wd."warehouseId" = w.id
               WHERE w.id = $1
               LIMIT 1`,
        values: [reqInt(a.id, 'id')],
      };
    },
  },

  warehouses_search: {
    desc: 'Filter warehouses. Optional params: city, type (PEB/RCC/Shed/BTS), min_sqft (int), ' +
      'available (yes/no), verified (true/false), limit (1-25). At least one filter recommended.',
    build(a) {
      const vals = [];
      const where = [];
      if (a.city != null && String(a.city).trim()) {
        vals.push(cityPatterns(String(a.city)));
        where.push(`city ILIKE ANY($${vals.length})`);
      }
      if (a.type != null && String(a.type).trim()) {
        vals.push(`%${String(a.type).trim()}%`);
        where.push(`"warehouseType" ILIKE $${vals.length}`);
      }
      if (a.available != null && String(a.available).trim()) {
        vals.push(`${String(a.available).trim()}%`);
        where.push(`availability ILIKE $${vals.length}`);
      }
      if (truthy(a.verified)) where.push(`"wogVerified" = true`);
      if (a.min_sqft != null && Number.isFinite(+a.min_sqft)) {
        vals.push(parseInt(a.min_sqft, 10));
        where.push(`EXISTS (SELECT 1 FROM unnest("totalSpaceSqft") s WHERE s >= $${vals.length})`);
      }
      const limit = clampInt(a.limit, 15, 1, 25);
      vals.push(limit);
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      return {
        sql: `SELECT id, city, zone, "warehouseType" AS type, "ratePerSqft" AS rate,
                     "totalSpaceSqft" AS sqft, availability, "wogVerified" AS verified
                FROM "Warehouse" ${whereSql}
            ORDER BY "wogVerified" DESC NULLS LAST, id DESC
               LIMIT $${vals.length}`,
        values: vals,
      };
    },
  },

  warehouse_count: {
    desc: 'Count of warehouses, optionally for one city (alias-aware so Bangalore+Bengaluru ' +
      'are summed). Params: city (optional). Use this for "how many in X".',
    build(a) {
      if (a.city != null && String(a.city).trim()) {
        return {
          sql: `SELECT count(*)::int AS n FROM "Warehouse" WHERE city ILIKE ANY($1)`,
          values: [cityPatterns(String(a.city))],
        };
      }
      return { sql: `SELECT count(*)::int AS n FROM "Warehouse"`, values: [] };
    },
  },

  warehouse_count_by_city: {
    desc: 'Count of warehouses grouped by city (top 20). No params.',
    build() {
      return {
        sql: `SELECT city, count(*)::int AS n FROM "Warehouse"
            GROUP BY city ORDER BY n DESC LIMIT 20`,
        values: [],
      };
    },
  },
};

const QUERY_NAMES = Object.keys(QUERIES);

// Run one named query. Returns { ok, rows, rowCount } or { ok:false, error }.
async function runNamedQuery(name, args) {
  const q = QUERIES[name];
  if (!q) return { ok: false, error: `unknown query "${name}". Available: ${QUERY_NAMES.join(', ')}` };
  const p = getPool();
  if (!p) return { ok: false, error: 'DB lookups are not configured' };
  let built;
  try { built = q.build(args || {}); }
  catch (e) { return { ok: false, error: e.message }; }
  try {
    const res = await p.query({ text: built.sql, values: built.values });
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (e) {
    console.error(`[dbread] query "${name}" failed:`, e.message);
    return { ok: false, error: 'query failed: ' + e.message.split('\n')[0] };
  }
}

// ---- directive parsing / formatting ---------------------------------------
const DATA_RE = /\[\[DATA\|([^\]]+)\]\]/gi;

function hasDataDirective(text) {
  DATA_RE.lastIndex = 0;
  return DATA_RE.test(text || '');
}

// Parse all [[DATA|q=..|k=v|..]] directives into [{ name, args, raw }].
function parseDataDirectives(text) {
  const out = [];
  for (const m of (text || '').matchAll(DATA_RE)) {
    const parts = m[1].split('|').map((s) => s.trim()).filter(Boolean);
    const args = {};
    let name = null;
    for (const part of parts) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k === 'q' || k === 'query') name = v;
      else args[k] = v;
    }
    if (name) out.push({ name, args, raw: m[0] });
  }
  return out;
}

// Strip every [[DATA|..]] directive from a string (used if any leak into final text).
function stripDataDirectives(text) {
  return (text || '').replace(DATA_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Compact, model-readable rendering of a query result for re-injection into context.
function formatResult(name, args, result) {
  const head = `DATA RESULT — ${name}(${JSON.stringify(args)})`;
  if (!result.ok) return `${head}: ERROR — ${result.error}`;
  if (!result.rows.length) return `${head}: 0 rows found.`;
  return `${head}: ${result.rows.length} row(s)\n\`\`\`json\n${JSON.stringify(result.rows)}\n\`\`\``;
}

module.exports = {
  runNamedQuery,
  hasDataDirective,
  parseDataDirectives,
  stripDataDirectives,
  formatResult,
  QUERY_NAMES,
  QUERIES,
};
