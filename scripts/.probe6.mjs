import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const txt = readFileSync('C:/WorkDirectory/marketswave-secrets/supabase-staging-admin-credentials.txt','utf8');
const email = (txt.match(/Email:\s*(\S+)/)||[])[1];
const password = (txt.match(/Password:\s*(\S+)/)||[])[1];
const keys = JSON.parse(readFileSync('C:/WorkDirectory/marketswave-secrets/supabase-staging-api-keys.json','utf8'));
const url = 'https://ujnmlwbpginplfnofhhv.supabase.co';
const anonKey = keys.find(k=>k.name==='anon').api_key;
const client = createClient(url, anonKey, { auth: { persistSession: false } });
const { error: e1 } = await client.auth.signInWithPassword({ email, password });
if (e1) { console.log('sign-in failed:', e1.message); process.exit(1); }
const svc = createClient(url, keys.find(k=>k.name==='service_role').api_key);
const { data: clients } = await svc.from('clients').select('id,name').order('created_at');
console.log('functions.invoke(), the exact path the page uses:\n');
for (const c of clients.slice(0,4)) {
  const { data, error } = await client.functions.invoke('get-total-portfolio-value', { body: { clientId: c.id } });
  let detail = '';
  if (error && error.context && typeof error.context.text === 'function') {
    try { detail = (await error.context.text()).slice(0,110); } catch (_) {}
  }
  console.log('  ', (c.name+'                 ').slice(0,18), '| error:', error ? error.message : 'none',
    '| data:', JSON.stringify(data), detail ? '| body: '+detail : '');
}
process.exit(0);
