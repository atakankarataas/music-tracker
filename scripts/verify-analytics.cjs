// Read-only integration smoke checks using the configured web reader.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), assert = require('node:assert/strict');
const original = Module._load;
const modules = new Map();
function load(filename) {
  if(modules.has(filename)) return modules.get(filename).exports;
  const mod = new Module(filename,module); mod.paths=module.paths; modules.set(filename,mod);
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return mod.exports;
}
Module._load = (request,...rest) => request==='server-only' ? {} : request==='next/cache' ? {unstable_cache:fn=>fn} : request.startsWith('@/') ? load(path.resolve(request.slice(2)+'.ts')) : original(request,...rest);
(async()=>{
  try {
    const {getWrappedArtists}=load(path.resolve('lib/wrapped.ts'));
    const {getHomePeriodData}=load(path.resolve('lib/home-features.ts'));
    const {getLegacyLibraryData}=load(path.resolve('lib/legacy-features.ts'));
    for(const year of [2023,2024,2025]) {
      const result=await getWrappedArtists(`${year}-01-01`,`${year}-11-12`);
      console.log(year,JSON.stringify({artists:result.artists.slice(0,5).map(a=>a.name),total:result.totalPlays,unknownPrivacy:result.unknownPrivacyPlays}));
    }
    const home=await getHomePeriodData('custom','2026-01-01','2026-09-28');
    const library=await getLegacyLibraryData({mode:'artists',period:'custom',start:'2026-01-01',end:'2026-09-28'});
    assert.deepEqual(home.topArtists.map(a=>[a.name,a.plays]),library.items.slice(0,5).map(a=>[a.title,a.count]));
    const filtered=await getLegacyLibraryData({mode:'tracks',period:'all',filter:{type:'artist',value:'Güneş'},search:'Mümkünse'});
    assert.ok(filtered.items.length>0,'Collaboration must be reachable under its second artist');
    console.log('Home/library rankings agree; secondary-artist track search succeeds:',filtered.items.map(a=>[a.title,a.count]));
    const empty=await getLegacyLibraryData({mode:'artists',period:'custom',start:'1900-01-01',end:'1900-01-02'});
    assert.equal(empty.totalItems,0);
  } finally {if(globalThis.__myscrobblerSql) await globalThis.__myscrobblerSql.end();}
})().catch(e=>{console.error(e.code??e.name,e.message);process.exitCode=1;});
