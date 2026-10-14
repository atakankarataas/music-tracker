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
(async()=>{
 const {sql}=load('lib/db.ts');
 try {
  const {getArtistDetail,searchEntities}=load('lib/data.ts');
  const {getDetailPageFeatures}=load('lib/detail-features.ts');
  const {getEntityLegacyFeatures,getLegacyLibraryData}=load('lib/legacy-features.ts');
  const {getListeningPatterns}=load('lib/listening-patterns.ts');
  const {formatNumber}=load('lib/format.ts');
  const artist='The Weeknd';
  const [expected]=await sql`SELECT sum(play_weight)::double precision AS plays FROM music_read.artist_plays WHERE artist_name=${artist}`;
  const detail=await getArtistDetail(artist);
  assert.equal(detail.totalPlays,expected.plays);
  const features=await getDetailPageFeatures("artist",artist,false,"all");
  assert.equal(features.lifetimePlays,expected.plays);
  assert.equal(features.periodPlays,expected.plays);
  const search=await searchEntities(artist);
  assert.equal(search.artists.find(x=>x.name===artist).plays,expected.plays);
  const legacy=await getEntityLegacyFeatures('artist',artist);
  assert.equal(legacy.totalPlays,expected.plays);
  const list=await getLegacyLibraryData({mode:'artists',search:artist,period:'all'});
  assert.equal(list.items.find(x=>x.title===artist).count,expected.plays);
  const pattern=await getListeningPatterns('2025-01-01','2025-11-12');
  assert.ok(pattern.top_five<=pattern.total);
  assert.ok(!formatNumber(231.15).includes('.'));
  console.log('Lifetime artist details, milestones, Library and rounded display agree; concentration bounded.');
  const views=await sql`SELECT count(*)::int AS n FROM music_read.scrobbles WHERE ms_played<=30000 OR incognito_mode IS TRUE`;
  assert.equal(views[0].n,0);
  const grants=await sql`SELECT has_schema_privilege('anon','music_read','USAGE') AS anon`;
  assert.equal(grants[0].anon,false);
  console.log('Eligibility and private read-schema permissions verified.');
 } finally {await sql.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
