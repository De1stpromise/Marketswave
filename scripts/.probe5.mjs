import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const txt = readFileSync('C:/WorkDirectory/marketswave-secrets/supabase-staging-admin-credentials.txt','utf8');
const email = (txt.match(/Email:\s*(\S+)/)||[])[1];
const password = (txt.match(/Password:\s*(\S+)/)||[])[1];
const keys = JSON.parse(readFileSync('C:/WorkDirectory/marketswave-secrets/supabase-staging-api-keys.json','utf8'));
const url = 'https://ujnmlwbpginplfnofhhv.supabase.co';
const anonKey = keys.find(k=>k.name==='anon').api_key;
const service = keys.find(k=>k.name==='service_role').api_key;
const anon = createClient(url, anonKey);
const { data: s, error } = await anon.auth.signInWithPassword({ email, password });
if (error) { console.log('staging PM sign-in FAILED:', error.message); process.exit(1); }
console.log('staging PM sign-in: ok');
const admin = createClient(url, service);
const { data: clients } = await admin.from('clients').select('id,name').order('created_at');
console.log('\nCalling get-total-portfolio-value per client, exactly as the list does:');
const t0 = Date.now();
const results = await Promise.all(clients.map(async c => {
  const st = Date.now();
  try {
    const r = await fetch(url+'/functions/v1/get-total-portfolio-value', { method:'POST',
      headers:{ Authorization:'Bearer '+s.session.access_token, 'Content-Type':'application/json' },
      body: JSON.stringify({ clientId: c.id }) });
    const body = await r.text();
    return { name:c.name, status:r.status, ms:Date.now()-st, body: body.slice(0,90) };
  } catch (e) { return { name:c.name, status:'THREW', ms:Date.now()-st, body:String(e.message).slice(0,90) }; }
}));
results.forEach(r=>console.log('  ', (r.name+'                 ').slice(0,18), '|', String(r.status).padStart(5), '|', String(r.ms).padStart(6)+'ms |', r.body));
console.log('total wall clock:', Date.now()-t0, 'ms');
process.exit(0);
