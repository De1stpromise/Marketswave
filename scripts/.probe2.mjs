import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
const st = JSON.parse(execSync('npx supabase status -o json', {cwd:'..',encoding:'utf8'}).replace(/^[^{]*/,''));
const anon = createClient(st.API_URL, st.ANON_KEY);
const { data: s } = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);
const { data: clients } = await admin.from('clients').select('id,name').order('created_at');
for (const c of clients.slice(0, 6)) {
  const call = async (fn, body) => {
    const r = await fetch(st.API_URL + '/functions/v1/' + fn, { method:'POST',
      headers:{ Authorization:'Bearer '+s.session.access_token, 'Content-Type':'application/json' },
      body: JSON.stringify(body) });
    return { status: r.status, body: await r.text() };
  };
  const tpv = await call('get-total-portfolio-value', { clientId: c.id });
  const prof = await call('get-client-profile', { clientId: c.id });
  let pv = '?';
  try { pv = JSON.parse(prof.body).money.portfolioValue; } catch (e) {}
  console.log((c.name+'                    ').slice(0,22),
    '| tpv HTTP', tpv.status, String(tpv.body).slice(0,70).padEnd(40),
    '| profile pv', pv);
}
process.exit(0);
