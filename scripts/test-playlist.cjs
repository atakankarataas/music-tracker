const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');
const reservations = new Map();
const providerCalls = [];
let authorized = true;
let failAdding = false;
let storedConnection;

async function sql(strings, ...values) {
  const query = strings.join('?');
  if (query.includes('SELECT *')) return reservations.has(values[0]) ? [reservations.get(values[0])] : [];
  if (query.includes('INSERT INTO')) {
    if (reservations.has(values[0])) return [];
    reservations.set(values[0], {fingerprint:values[1], status:'creating'});
    return [{request_id:values[0]}];
  }
  if (query.includes("status='adding'")) Object.assign(reservations.get(values[2]), {status:'adding',url:values[1]});
  if (query.includes("status='complete'")) reservations.get(values[0]).status='complete';
  if (query.includes("status='failed'")) reservations.get(values[0]).status='failed';
  return [];
}
const original = Module._load;
Module._load = (request, ...rest) => {
  if (request === 'server-only') return {};
  if (request === 'next/headers') return {cookies:async()=>({get:()=>storedConnection?{value:storedConnection}:undefined})};
  if (request === 'next/server') return {NextResponse:{json:(body,options)=>({body,status:options?.status??200})}};
  if (request === '@/lib/db') return {sql};
  if (request === '@/lib/origin') return {isSameOrigin:request=>request.sameOrigin};
  if (request === '@/lib/spotify-web') return {
    playlistToken:async()=>authorized?'test-token':null,
    spotifyFetch:async(_token,route,body)=>{
      providerCalls.push({route,body});
      return {ok:!(failAdding && route.endsWith('/items')),json:async()=>({id:'p'.repeat(22)})};
    },
  };
  return original(request,...rest);
};
const filename = path.resolve('app/api/spotify/playlists/route.ts');
const mod = new Module(filename,module);
mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,filename);
const requestId='12345678-1234-1234-1234-123456789abc';
const selection={name:'Test selection',ids:['a'.repeat(22),'a'.repeat(22)],requestId};
const post=(body=selection,sameOrigin=true)=>mod.exports.POST({sameOrigin,json:async()=>body});
(async()=>{
  assert.equal((await post(selection,false)).status,403);
  assert.equal((await post({...selection,ids:['invalid']})).status,400);
  authorized=false;
  assert.equal((await post()).status,401);
  assert.equal(providerCalls.length,0);
  authorized=true;
  const created=await post();
  assert.equal(created.status,200);
  assert.equal(providerCalls.length,2);
  assert.equal(providerCalls[0].route,'/me/playlists');
  assert.equal(providerCalls[0].body.public,false);
  assert.equal(providerCalls[1].body.uris.length,1);
  assert.equal((await post()).body.url,created.body.url);
  assert.equal(providerCalls.length,2);
  assert.equal((await post({...selection,name:'Changed'})).status,409);
  failAdding=true;
  const failed={...selection,requestId:'22345678-1234-1234-1234-123456789abc'};
  assert.equal((await post(failed)).status,502);
  assert.equal((await post(failed)).status,409);
  assert.equal(providerCalls.length,4);
  const cryptoFilename=path.resolve('lib/spotify-web.ts');
  const cryptoModule=new Module(cryptoFilename,module);
  cryptoModule.paths=module.paths;
  cryptoModule._compile(ts.transpileModule(fs.readFileSync(cryptoFilename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,cryptoFilename);
  const {seal,unseal,playlistToken}=cryptoModule.exports;
  const originalSecret=process.env.SITE_PASSWORD;
  try {
    process.env.SITE_PASSWORD='unit-test-secret';
    const value={refresh:'not-a-real-token',scope:'playlist-modify-private',expires:Date.now()+10000};
    const encrypted=seal(value);
    assert.deepEqual(unseal(encrypted),value);
    const bytes=Buffer.from(encrypted,'base64url');bytes[15]^=1;
    assert.equal(unseal(bytes.toString('base64url')),null);
    process.env.SITE_PASSWORD='different-secret';
    assert.equal(unseal(encrypted),null);
    process.env.SITE_PASSWORD='unit-test-secret';
    storedConnection=seal({...value,expires:0});
    assert.equal(await playlistToken(),null);
    storedConnection=seal({...value,scope:'user-read-recently-played'});
    assert.equal(await playlistToken(),null);
  } finally {
    if(originalSecret===undefined)delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD=originalSecret;
  }
  console.log('Spotify encrypted connection, expiry and scope tests passed.');
  console.log('Playlist validation, private creation, deduplication, retry and partial-failure tests passed (Spotify mocked).');
})().catch(error=>{console.error(error);process.exitCode=1;});
