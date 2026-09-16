import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const keys = JSON.parse(readFileSync('C:/WorkDirectory/marketswave-secrets/supabase-staging-api-keys.json','utf8'));
const url = 'https://ujnmlwbpginplfnofhhv.supabase.co';
const row = keys.find(function (k) { return k.name === 'service_role'; });
const service = row && row.api_key;
if (!service) { console.log('no service_role key in the file'); process.exit(1); }
const admin = createClient(url, service);
const { data: clients, error } = await admin.from('clients').select('id,name,email,status,created_at').order('created_at');
if (error) { console.log('clients read failed:', error.message); process.exit(1); }
console.log('REAL STAGING clients:', clients.length);
for (const c of clients) {
  const [h, a, t] = await Promise.all([
    admin.from('holdings').select('*',{count:'exact',head:true}).eq('client_id',c.id),
    admin.from('account_state').select('unallocated_capital, allocated_capital, asset_returns').eq('client_id',c.id).maybeSingle(),
    admin.from('transactions').select('*',{count:'exact',head:true}).eq('client_id',c.id)
  ]);
  console.log('  ', (c.name+'                  ').slice(0,20), '| holdings', String(h.count).padStart(2),
    '| txns', String(t.count).padStart(3), '| acct', a.data ? JSON.stringify(a.data) : 'NO ROW');
}
const { count: prods } = await admin.from('products').select('*',{count:'exact',head:true});
console.log('products on staging:', prods);
process.exit(0);
