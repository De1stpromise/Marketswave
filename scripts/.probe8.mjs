import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
const st = JSON.parse(execSync('npx supabase status -o json', {cwd:'..',encoding:'utf8'}).replace(/^[^{]*/,''));
const anon = createClient(st.API_URL, st.ANON_KEY);
const { data: s } = await anon.auth.signInWithPassword({ email:'pm@marketswave.local', password:'MarketswavePM-Local-2026!' });
const tok = s.session.access_token;
const call = async (fn, body) => { const r = await fetch(st.API_URL+'/functions/v1/'+fn, { method:'POST',
  headers:{ Authorization:'Bearer '+tok, 'Content-Type':'application/json' }, body: JSON.stringify(body||{}) });
  return { status:r.status, json: await r.json().catch(()=>null) }; };
const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);
const list = (await call('get-client-list', {})).json;
console.log('client'.padEnd(21), 'list'.padStart(11), 'tpv-fn'.padStart(11), 'holdings', ' match');
let bad = 0;
for (const c of list.clients) {
  const tpv = (await call('get-total-portfolio-value', { clientId: c.id })).json;
  const { count } = await admin.from('holdings').select('*',{count:'exact',head:true}).eq('client_id', c.id);
  const a = c.portfolioValue, b = tpv && tpv.totalPortfolioValue;
  const ok = a !== null && b !== undefined && Math.abs(a-b) < 0.02;
  if (!ok) bad++;
  console.log((c.name+'                    ').slice(0,21), String(a).padStart(11), String(b).padStart(11),
    String(count).padStart(8), ok ? '  ok' : '  *** MISMATCH');
}
console.log(bad ? ('\n'+bad+' MISMATCHES') : '\nall sources agree');
process.exit(0);
