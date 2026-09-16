import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
const st = JSON.parse(execSync('npx supabase status -o json', {cwd:'..',encoding:'utf8'}).replace(/^[^{]*/,''));
const anon = createClient(st.API_URL, st.ANON_KEY);
const { data: s, error } = await anon.auth.signInWithPassword({ email:'pm@marketswave.local', password:'MarketswavePM-Local-2026!' });
if (error) { console.log('sign-in:', error.message); process.exit(1); }
const r = await fetch(st.API_URL+'/functions/v1/get-client-list', { method:'POST',
  headers:{ Authorization:'Bearer '+s.session.access_token, 'Content-Type':'application/json' }, body:'{}' });
const t = await r.text();
if (r.status !== 200) { console.log('HTTP', r.status, t.slice(0,300)); process.exit(1); }
const j = JSON.parse(t);
console.log('HTTP 200 |', j.clients.length, 'clients');
console.log('strip:', JSON.stringify(j.strip));
j.clients.slice(0,7).forEach(c=>console.log('  ', (c.name+'                  ').slice(0,20),
  '| pv', String(c.portfolioValue).padStart(10), '| avail', c.valueAvailable, '| funded', String(c.funded).padEnd(5),
  '| unalloc', String(c.unallocated).padStart(9), '| ret', String(c.totalReturn).padStart(9), '| pend', c.pendingCount,
  '| dormant', c.dormant, c.dormantDays));
process.exit(0);
