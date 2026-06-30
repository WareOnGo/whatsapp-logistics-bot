require('dotenv').config();
const axios = require('axios'); const https = require('https');
const { parseDataDirectives, runNamedQuery, formatResult, stripDataDirectives } = require('./src/services/dbReadService');
const URL = process.env.OPENCLAW_URL, TOK = process.env.OPENCLAW_TOKEN;
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const P = 'DATA RESULTS for your lookup(s). Use ONLY these rows to answer. Do NOT show raw JSON, the directive, or ids unless asked. Never invent rows.\n\n';
async function ask(m){ const r=await axios.post(`${URL}/v1/chat/completions`,{model:'openclaw/main',messages:m},{headers:{Authorization:`Bearer ${TOK}`,'Content-Type':'application/json'},httpsAgent,timeout:90000}); return r.data?.choices?.[0]?.message?.content?.trim()||'(none)'; }
async function run(q){ console.log('\n===== USER:',q); const m=[{role:'system',content:'You are talking to WhatsApp user +91test.'},{role:'user',content:q}];
  for(let h=0;h<4;h++){ const a=await ask(m); const d=parseDataDirectives(a); if(!d.length){console.log('FINAL >>',stripDataDirectives(a));return;}
    console.log('  [lookup]',d.map(x=>x.name+JSON.stringify(x.args)).join(', ')); const res=[];
    for(const x of d){ const rr=await runNamedQuery(x.name,x.args); res.push(formatResult(x.name,x.args,rr)); }
    m.push({role:'assistant',content:a}); m.push({role:'user',content:P+res.join('\n\n')}); } console.log('FINAL >> (cap)'); }
(async()=>{ await run('show me rcc warehouses in hyderabad'); await run('any warehouses in whitefield bangalore over 50000 sqft?'); })().catch(e=>console.log('ERR',e.response?.status,e.message));
