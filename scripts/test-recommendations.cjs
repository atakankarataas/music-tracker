// Opt-in, read-only integration check: NODE_ENV=production node --env-file=.env scripts/test-wrapped.cjs
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const assert = require('node:assert/strict');
const modules = new Map();
const originalLoad = Module._load;
function load(file) {
  const filename = path.resolve(file);
  if (modules.has(filename)) return modules.get(filename).exports;
  const mod = new Module(filename, module);
  modules.set(filename, mod);
  mod.paths = module.paths;
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return mod.exports;
}
Module._load = (request, ...rest) => {
  if (request === 'server-only') return {};
  if (request === 'next/cache') return { unstable_cache: (fn) => fn };
  if (request.startsWith('@/')) return load(`${request.slice(2)}.ts`);
  return originalLoad(request, ...rest);
};
const {chooseRecommendations,songKey}=load('lib/recommendation-ranking.ts');
assert.equal(songKey('Song - 2011 Remaster','Artist'),songKey('Song','Artist'));
const candidates=Array.from({length:60},(_,i)=>({id:`t${i}`,name:`Song ${i}`,artist:`Artist ${i%10}`,artistId:`a${i%10}`,imageUrl:null,seed:'Seed',familiar:i>=40,score:100-i}));
const picks=chooseRecommendations(candidates);
assert.equal(picks.length,20);assert.equal(picks.filter(x=>x.familiar).length,4);
for(const id of new Set(picks.map(x=>x.artistId))) assert.ok(picks.filter(x=>x.artistId===id).length<=3);
assert.equal(chooseRecommendations([candidates[0],{...candidates[0],id:'different-edition'}]).length,1);
assert.equal(chooseRecommendations(candidates.filter(x=>!x.familiar)).length,20);
assert.ok(chooseRecommendations(candidates.filter(x=>x.familiar)).every(x=>x.familiar));
console.log('Recommendation mix, per-artist cap, edition deduplication and graceful sparse pools passed.');
if(process.env.TEST_SPOTIFY_CATALOG==='1') (async()=>{
 const {sql}=load('lib/db.ts');
 try {
  const {getRecommendations}=load('lib/recommendations.ts');
  for(const period of ['30d','year']) {
   const data=await getRecommendations(period);
   console.log(JSON.stringify({period,seeds:data.seeds.length,picks:data.picks.length,new:data.picks.filter(x=>!x.familiar).length,familiar:data.picks.filter(x=>x.familiar).length,unavailable:data.unavailable}));
   assert.ok(data.picks.length>0);assert.ok(!data.unavailable);
   assert.ok(data.picks.filter(x=>!x.familiar).length>data.picks.length/2);
   const known=await sql`SELECT spotify_id FROM public.scrobbles WHERE spotify_id IN ${sql(data.picks.filter(x=>!x.familiar).map(x=>x.id))}`;
   assert.equal(known.length,0);
  }
 } finally {await sql.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
