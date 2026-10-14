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
(async () => {
  assert.ok(process.env.WEB_DB_URI, 'This read-only check requires WEB_DB_URI');
  const { sql } = load('lib/db.ts');
  try {
    const { getWrappedData } = load('lib/wrapped.ts');
    const { getLegacyLibraryData } = load('lib/legacy-features.ts');
    const { wrappedRange } = load('lib/periods.ts');
    const referencePath = process.env.WRAPPED_REFERENCE_FILE ?? 'reports/wrapped-reference.json';
    const references = fs.existsSync(referencePath) ? JSON.parse(fs.readFileSync(referencePath, 'utf8')) : {};
    for (const year of ['2023', '2024', '2025', '2026']) {
      const { start, end } = wrappedRange(year);
      const recap = await getWrappedData(start, end);
      const list = await getLegacyLibraryData({ mode: 'artists', period: 'custom', start, end, wrapped: true });
      assert.deepEqual(recap.topArtists.slice(0, 10).map(x => [x.name, x.plays]),
        list.items.slice(0, 10).map(x => [x.title, x.count]), `${year}: Wrapped and View all disagree`);
      for (const [mode, items] of [['tracks', recap.topTracks], ['albums', recap.topAlbums]]) {
        const full = await getLegacyLibraryData({ mode, period: 'custom', start, end, wrapped: true });
        assert.deepEqual(items.slice(0, 10).map(x => [x.name, x.secondary, x.plays, x.id]),
          full.items.slice(0, 10).map(x => [x.title, x.subtitle, x.count, x.id]), `${year}: ${mode} View all differs`);
      }
      const [counts] = await sql`SELECT count(*) FILTER (WHERE (ms_played IS NULL OR ms_played > 30000) AND incognito_mode IS NOT TRUE)::int AS eligible
        FROM scrobbles WHERE played_at >= ${start}::date::timestamp AT TIME ZONE 'Europe/Istanbul'
          AND played_at < (${end}::date+1)::timestamp AT TIME ZONE 'Europe/Istanbul'`;
      assert.equal(recap.totalPlays, counts.eligible);
      if (references[year]) {
        assert.deepEqual(recap.topArtists.slice(0, 5).map(x => x.name), references[year].artists,
          `${year}: supplied Wrapped reference differs from estimate`);
      }
      const raw = await getLegacyLibraryData({ mode: 'artists', period: 'custom', start, end });
      const expected = await sql`WITH credits AS (
        SELECT spotify_id,artist_id,max(artist_name) AS name FROM music_track_artists GROUP BY spotify_id,artist_id
      ) SELECT coalesce(c.name,s.artist_name) AS name,count(*)::int AS plays
      FROM scrobbles s LEFT JOIN credits c USING(spotify_id)
      WHERE played_at >= ${start}::date::timestamp AT TIME ZONE 'Europe/Istanbul'
        AND played_at < (${end}::date+1)::timestamp AT TIME ZONE 'Europe/Istanbul'
      GROUP BY coalesce(c.name,s.artist_name) ORDER BY count(*) DESC,name LIMIT 10`;
      assert.deepEqual(raw.items.slice(0, 10).map(x => [x.title,x.count]), expected.map(x => [x.name,x.plays]));
      console.log(`${year}: weighted recap/View all agree; eligibility agrees; normal archive stays unweighted${references[year] ? '; reference top five matches' : ''}`);
    }
  } finally { await sql.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
