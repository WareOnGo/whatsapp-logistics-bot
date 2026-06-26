// Data-cleanup orchestration: CSV/XLSX in → cleaned file + summary out.
//
// Flow (agent proposes rules, deterministic code disposes):
//   1. parse the file (papaparse / xlsx) into rows
//   2. ask the `datacleanup` agent for a cleanup SPEC, given the skill + headers + a sample
//   3. apply the spec to ALL rows deterministically (cleanupSpec.applySpec — no LLM, no exec)
//   4. write the cleaned file to R2 and return its URL + a human summary
//
// The LLM only ever sees headers + a small sample (cheap, safe); it never transforms rows.

const axios = require('axios');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const { applySpec, formatSummary } = require('./cleanupSpec');
const { uploadBuffer } = require('./storageService');

const OPENCLAW_URL = process.env.OPENCLAW_URL;
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN;
const MAX_ROWS = 5000;   // lightweight by design; guard against huge files
const SAMPLE_ROWS = 12;  // rows shown to the agent to infer the spec

function parseFile(buffer, kind) {
  if (kind === 'csv') {
    const out = Papa.parse(buffer.toString('utf8'), { header: true, skipEmptyLines: true });
    return out.data;
  }
  // xlsx / xls
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function toCsvBuffer(rows) {
  return Buffer.from(Papa.unparse(rows), 'utf8');
}

// Robustly pull a JSON object out of an LLM reply (handles ```json fences / prose).
function extractSpec(text) {
  let t = (text || '').trim().replace(/```json\s*|```/gi, '');
  const start = t.indexOf('{'); const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return { operations: [] };
  try { const obj = JSON.parse(t.slice(start, end + 1)); return obj.operations ? obj : { operations: [] }; }
  catch { return { operations: [] }; }
}

// Ask the datacleanup agent for a spec. headers + sample only — never the full file.
async function requestSpec(headers, sampleRows, instruction) {
  const sys =
    'You are WareOnGo\'s data-cleanup agent. Given a table\'s columns + a sample of rows, ' +
    'output ONLY a JSON cleanup spec: {"operations":[...]}. Use ONLY these ops:\n' +
    'cell: trim, collapse_spaces, titlecase, uppercase, lowercase, phone_e164{country}, ' +
    'to_int, to_number, regex_replace{pattern,replace}, map_values{mapping}, default_if_empty{value} ' +
    '(each needs "column"); row: dedupe{keys[]}, drop_if_empty{columns[]}, drop_if{column,equals|regex}. ' +
    'Apply the relevant cleanup skill in your workspace. Output JSON only, no prose.';
  const user =
    (instruction ? `User instruction: ${instruction}\n\n` : '') +
    `Columns: ${JSON.stringify(headers)}\n\nSample rows:\n${JSON.stringify(sampleRows, null, 1)}`;
  const resp = await axios.post(`${OPENCLAW_URL}/v1/chat/completions`, {
    model: 'openclaw/datacleanup',
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
  }, { headers: { Authorization: `Bearer ${OPENCLAW_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 90000 });
  return extractSpec(resp.data?.choices?.[0]?.message?.content || '');
}

// Main entry. buffer = the uploaded file; kind = 'csv'|'xlsx'; instruction = optional caption.
// Returns { ok, r2Url?, fileName?, summaryText, error? }.
async function cleanFile(buffer, kind, instruction) {
  let rows;
  try { rows = parseFile(buffer, kind); }
  catch (e) { return { ok: false, error: `couldn't read the file (${e.message.slice(0, 60)})` }; }
  if (!rows.length) return { ok: false, error: 'the file looks empty' };
  if (rows.length > MAX_ROWS) return { ok: false, error: `that file has ${rows.length} rows — I handle up to ${MAX_ROWS}` };

  const headers = Object.keys(rows[0]);
  const sample = rows.slice(0, SAMPLE_ROWS);
  const spec = await requestSpec(headers, sample, instruction);
  if (!spec.operations.length) return { ok: false, error: "I couldn't work out cleanup rules for this file" };

  const { rows: cleaned, summary } = applySpec(rows, spec);
  const fileName = `assistant-media/cleaned_${Date.now()}.csv`;
  const r2Url = await uploadBuffer(toCsvBuffer(cleaned), fileName, 'text/csv');
  return { ok: true, r2Url, fileName, summaryText: formatSummary(summary), spec };
}

module.exports = { cleanFile, parseFile, extractSpec };
