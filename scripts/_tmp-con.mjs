import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const profile=mkdtempSync(join(tmpdir(),'con-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
 ['--headless=new','--remote-debugging-port=9403','--user-data-dir='+profile,'--no-first-run','--disable-extensions','about:blank'],{stdio:'ignore'});
let ws=null;
for(let i=0;i<40&&!ws;i++){await sleep(300);try{const t=await(await fetch('http://127.0.0.1:9403/json/list')).json();const p=t.find(x=>x.type==='page');if(p)ws=p.webSocketDebuggerUrl;}catch(e){}}
const sock=new WebSocket(ws); await new Promise(r=>{sock.onopen=r;});
let id=0; const pend=new Map(); const logs=[];
sock.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown') logs.push('EXCEPTION: '+JSON.stringify(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text).slice(0,300));
  if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error') logs.push('CONSOLE: '+m.params.args.map(a=>a.value||a.description).join(' ').slice(0,200));
  if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
const send=(m,p)=>new Promise(r=>{const i=++id;pend.set(i,r);sock.send(JSON.stringify({id:i,method:m,params:p||{}}));});
const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return r.result?.result?.value;};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setFocusEmulationEnabled',{enabled:true});
await send('Page.navigate',{url:'http://127.0.0.1:8765/signup.html'}); await sleep(5000);
console.log('--- console errors ---'); logs.forEach(l=>console.log(' ',l));
console.log('--- state ---');
console.log(await ev(`JSON.stringify({
  activeStep: document.querySelector('.signup-step.is-active')?.dataset.step ?? null,
  stepCount: document.querySelectorAll('.signup-step').length,
  radios: document.querySelectorAll('input[name="account_type"]').length,
  radioDisplay: getComputedStyle(document.querySelector('input[name="account_type"]')).display,
  hasFocus: document.hasFocus(),
  uploadCtl: typeof window.MarketswaveUpload
})`));
// activate step 8 and tab to the upload
await ev(`(() => { document.querySelectorAll('.signup-step').forEach(e=>e.classList.remove('is-active'));
  document.querySelector('.signup-step[data-step="8"]').classList.add('is-active'); return true; })()`);
await sleep(400);
for (let i=0;i<80;i++){
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',windowsVirtualKeyCode:9,key:'Tab',code:'Tab'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',windowsVirtualKeyCode:9,key:'Tab',code:'Tab'});
  await sleep(40);
  if (await ev('document.activeElement.id === "signup-upload-id"')) break;
}
console.log('--- upload focus state ---');
console.log(await ev(`JSON.stringify({
  active: document.activeElement.id,
  matchesFocus: document.activeElement.matches(':focus'),
  matchesFocusVisible: (()=>{try{return document.activeElement.matches(':focus-visible')}catch(e){return 'ERR '+e.message}})(),
  nextSibling: document.activeElement.nextElementSibling ? document.activeElement.nextElementSibling.tagName+'.'+document.activeElement.nextElementSibling.className : null,
  faceShadow: getComputedStyle(document.querySelector('label.mw-upload-face[for="signup-upload-id"]')).boxShadow
})`));
// Tab test
await send('Input.dispatchKeyEvent',{type:'rawKeyDown',windowsVirtualKeyCode:9,key:'Tab',code:'Tab'});
await send('Input.dispatchKeyEvent',{type:'keyUp',windowsVirtualKeyCode:9,key:'Tab',code:'Tab'});
await sleep(200);
console.log('after 1 Tab, activeElement =', await ev('document.activeElement.tagName+"."+(document.activeElement.className||"").slice(0,40)'));
sock.close();chrome.kill();try{rmSync(profile,{recursive:true,force:true});}catch(e){}
process.exit(0);
