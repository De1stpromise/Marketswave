import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const st = JSON.parse(execSync('npx supabase status -o json', {cwd:ROOT,encoding:'utf8'}).replace(/^[^{]*/,''));
globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
globalThis.document = { addEventListener() {} };
await import('../supabase-data.js');
const MarketswaveData = globalThis.window.MarketswaveData;
const cfg = await import('../admin-supabase-config.js');
const { error } = await cfg.supabase.auth.signInWithPassword({ email:'pm@marketswave.local', password:'MarketswavePM-Local-2026!' });
console.log('admin sign-in error:', error ? error.message : 'none');

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => errs.push(String(e.message).slice(0,140)));
const html = readFileSync(path.join(ROOT,'admin-clients.html'),'utf8');
const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/)||[])[1].replace(/<script[\s\S]*?<\/script>/g,'');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const pageScript = scripts.find(s=>s.indexOf('supabaseRowToClientRecord')!==-1);
const dom = new JSDOM('<!doctype html><html><body>'+body+'</body></html>', { url:'http://127.0.0.1:8765/admin-clients.html', runScripts:'outside-only', virtualConsole: vc, pretendToBeVisual:true });
dom.window.MarketswaveData = MarketswaveData;
for (const f of ['engine-core.js','format-helpers.js','asset-mark.js']) {
  try { dom.window.eval(readFileSync(path.join(ROOT,f),'utf8')); } catch(e){ console.log('load '+f+' failed:', String(e.message).slice(0,90)); }
}
dom.window.initAdminSidebar = function(){};
// ★ REPRODUCTION: mirror Gary into the LOCAL registry exactly as mirrorAuthenticatedClientLocally()
// does when someone signs in as him in this browser, then re-render and see which path wins.
const svc = createClient(st.API_URL, st.SERVICE_ROLE_KEY);
const { data: garyRow } = await svc.from('clients').select('id,name,email,phone,account_type,status').ilike('name','%Gary%').maybeSingle();
if (process.env.MIRROR_GARY === '1' && garyRow) {
  dom.window.eval('mirrorAuthenticatedClientLocally(' + JSON.stringify({
    id: garyRow.id, name: garyRow.name, email: garyRow.email, phone: garyRow.phone,
    accountType: garyRow.account_type, status: garyRow.status
  }) + ');');
  console.log('(mirrored Gary into the local registry first)');
}
try { dom.window.eval(pageScript); } catch(e){ console.log('page script threw:', String(e.message).slice(0,160)); }
const sleep = ms => new Promise(r=>setTimeout(r,ms));
for (let i=0;i<120;i++){ if (dom.window.document.querySelectorAll('.client-row').length) break; await sleep(200); }
const rows = [...dom.window.document.querySelectorAll('.client-row')].map(r=>r.textContent.replace(/\s+/g,' ').trim().slice(0,105));
console.log('rendered rows:', rows.length);
rows.slice(0,8).forEach(r=>console.log('  ', r));
if (errs.length) console.log('jsdom errors:', errs.slice(0,3));
process.exit(0);
