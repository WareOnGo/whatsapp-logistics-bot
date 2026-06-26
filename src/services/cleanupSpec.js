// Deterministic data-cleanup executor.
//
// The agent (datacleanup) proposes a structured SPEC; this module applies it to ALL rows
// in plain code — no LLM transforms rows, so no dropped/hallucinated data. Only ops in the
// fixed vocabulary below are honored; unknown ops are ignored (and reported), so a bad spec
// can never do something arbitrary. Every run returns a change summary for human review.
//
// Spec shape:
//   { operations: [ {op, column?, ...args}, ... ] }
// Cell ops (per value): trim, collapse_spaces, titlecase, uppercase, lowercase,
//   phone_e164, to_int, to_number, regex_replace{pattern,replace}, map_values{mapping},
//   default_if_empty{value}
// Row ops: dedupe{keys[]}, drop_if_empty{columns[]}, drop_if{column, equals|regex}

const CELL_OPS = new Set([
  'trim', 'collapse_spaces', 'titlecase', 'uppercase', 'lowercase',
  'phone_e164', 'to_int', 'to_number', 'regex_replace', 'map_values', 'default_if_empty',
]);
const ROW_OPS = new Set(['dedupe', 'drop_if_empty', 'drop_if']);

const titlecase = (s) => s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

// Normalize a phone to E.164. Default country India (+91). Conservative: only reformats
// when it can confidently produce a valid-length number; otherwise leaves the value as-is.
function phoneE164(raw, country = 'IN') {
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;          // already E.164
  const d = digits.replace(/\D/g, '');
  if (country === 'IN') {
    if (d.length === 10) return `+91${d}`;
    if (d.length === 12 && d.startsWith('91')) return `+${d}`;
    if (d.length === 11 && d.startsWith('0')) return `+91${d.slice(1)}`;
  }
  return raw; // can't confidently normalize — leave untouched
}

function applyCellOp(value, op) {
  let v = value == null ? '' : String(value);
  switch (op.op) {
    case 'trim': return v.trim();
    case 'collapse_spaces': return v.replace(/\s+/g, ' ').trim();
    case 'titlecase': return titlecase(v);
    case 'uppercase': return v.toUpperCase();
    case 'lowercase': return v.toLowerCase();
    case 'phone_e164': return phoneE164(v, op.country || 'IN');
    case 'to_int': { const n = parseInt(v.replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) ? n : v; }
    case 'to_number': { const n = parseFloat(v.replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : v; }
    case 'regex_replace': { try { return v.replace(new RegExp(op.pattern, op.flags || 'g'), op.replace ?? ''); } catch { return v; } }
    case 'map_values': { const m = op.mapping || {}; const key = v.trim().toLowerCase(); return m[key] != null ? m[key] : (m[v] != null ? m[v] : v); }
    case 'default_if_empty': return v.trim() === '' ? (op.value ?? v) : v;
    default: return v;
  }
}

// rows: array of plain objects (column -> value). Returns { rows, summary }.
function applySpec(rows, spec) {
  const ops = Array.isArray(spec?.operations) ? spec.operations : [];
  const summary = { inputRows: rows.length, outputRows: 0, cellChanges: {}, rowsDropped: {}, ignoredOps: [] };
  let out = rows.map((r) => ({ ...r }));

  for (const op of ops) {
    if (CELL_OPS.has(op.op)) {
      const col = op.column;
      if (!col) { summary.ignoredOps.push({ op: op.op, reason: 'missing column' }); continue; }
      let changed = 0;
      for (const row of out) {
        if (!(col in row)) continue;
        const before = row[col];
        const after = applyCellOp(before, op);
        const beforeNorm = before == null ? '' : before;
        // Strict !== so a type coercion (e.g. "25000" -> 25000) counts and is written,
        // even when the string forms match. Identical no-op values are skipped.
        if (after !== beforeNorm) { row[col] = after; changed++; }
      }
      const label = `${op.op}:${col}`;
      summary.cellChanges[label] = (summary.cellChanges[label] || 0) + changed;
    } else if (op.op === 'drop_if_empty') {
      const cols = op.columns || (op.column ? [op.column] : []);
      const before = out.length;
      out = out.filter((row) => cols.every((c) => String(row[c] ?? '').trim() !== ''));
      summary.rowsDropped[`drop_if_empty:${cols.join(',')}`] = before - out.length;
    } else if (op.op === 'drop_if') {
      const before = out.length;
      const { column, equals, regex } = op;
      let re = null; if (regex) { try { re = new RegExp(regex); } catch { re = null; } }
      out = out.filter((row) => {
        const val = String(row[column] ?? '');
        if (equals != null) return val !== String(equals);
        if (re) return !re.test(val);
        return true;
      });
      summary.rowsDropped[`drop_if:${column}`] = before - out.length;
    } else if (op.op === 'dedupe') {
      const keys = op.keys || (op.column ? [op.column] : Object.keys(out[0] || {}));
      const seen = new Set(); const before = out.length;
      out = out.filter((row) => {
        const k = keys.map((c) => String(row[c] ?? '').trim().toLowerCase()).join('');
        if (seen.has(k)) return false; seen.add(k); return true;
      });
      summary.rowsDropped[`dedupe:${keys.join(',')}`] = before - out.length;
    } else {
      summary.ignoredOps.push({ op: op.op, reason: 'unknown op' });
    }
  }
  summary.outputRows = out.length;
  return { rows: out, summary };
}

// Human-readable one-message summary for WhatsApp.
function formatSummary(s) {
  const lines = [`✅ Cleaned: ${s.inputRows} → ${s.outputRows} rows`];
  const drops = Object.entries(s.rowsDropped).filter(([, n]) => n > 0);
  if (drops.length) lines.push('Rows removed: ' + drops.map(([k, n]) => `${n} (${k.split(':')[0]})`).join(', '));
  const cells = Object.entries(s.cellChanges).filter(([, n]) => n > 0);
  if (cells.length) lines.push('Fields fixed: ' + cells.map(([k, n]) => `${n}× ${k}`).join(', '));
  if (s.ignoredOps.length) lines.push(`(skipped ${s.ignoredOps.length} unrecognized rule(s))`);
  return lines.join('\n');
}

module.exports = { applySpec, formatSummary, CELL_OPS, ROW_OPS };
