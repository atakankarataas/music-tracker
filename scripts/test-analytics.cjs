// Opt-in SQL regression tests. Only TEMP tables are written; no archive changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const postgres = require('postgres');

if (process.env.MUSIC_TEST_DATABASE !== '1') {
  console.log('SQL artist-credit tests skipped (set MUSIC_TEST_DATABASE=1 with WEB_DB_URI).');
} else {
  const sql = postgres(process.env.WEB_DB_URI, {ssl:'require',prepare:false,max:1,connect_timeout:15});
  (async () => {
    try {
      await sql.begin(async tx => {
        await tx`CREATE TEMP TABLE scrobbles (spotify_id text, artist_name text, image_url text,
          ms_played integer, incognito_mode boolean, played_at timestamptz) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE music_track_artists (spotify_id text, artist_id text,
          artist_name text, position integer) ON COMMIT DROP`;
        await tx`INSERT INTO music_track_artists VALUES ('duet','a','Lead',0),('duet','b','Guest',1),('duet','b','Guest',2)`;
        await tx`INSERT INTO scrobbles VALUES
          ('duet','Lead',NULL,60000,false,'2000-01-01T00:00Z'),
          ('duet','Lead',NULL,60000,false,'2000-01-02T00:00Z'),
          ('duet','Lead',NULL,60000,false,'2000-01-03T00:00Z'),
          ('duet','Lead',NULL,60000,true,'2000-01-04T00:00Z'),
          ('duet','Lead',NULL,30000,false,'2000-01-05T00:00Z'),
          ('duet','Lead',NULL,29999,false,'2000-01-06T00:00Z'),
          ('missing','Fallback',NULL,NULL,NULL,'2000-01-07T00:00Z'),
          ('duet','Lead',NULL,60000,false,'2000-02-01T00:00Z')`;
        const scoped = (strings,...values) => {
          const safe = strings.map(s => s.replaceAll('public.scrobbles','pg_temp.scrobbles').replaceAll('public.music_track_artists','pg_temp.music_track_artists'));
          safe.raw = safe; return tx(safe,...values);
        };
        const original = Module._load;
        Module._load = (request,...rest) => request === 'server-only' ? {} : request === '@/lib/db' ? {sql:scoped} : original(request,...rest);
        const filename = path.resolve('lib/wrapped.ts');
        const mod = new Module(filename,module); mod.paths=module.paths;
        mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
        Module._load = original;
        const {getWrappedArtists} = mod.exports;
        const weighted = await getWrappedArtists('2000-01-01','2000-01-31');
        assert.deepEqual(weighted.artists.map(a=>a.name),['Lead','Guest','Fallback']);
        assert.equal(weighted.artists[1].plays,3);
        assert.ok(Math.abs(weighted.artists[1].score-1.05)<1e-9);
        assert.equal(weighted.totalPlays,4);
        assert.equal(weighted.creditedPlays,3);
        assert.equal(weighted.distinctArtists,3);
        assert.equal(weighted.unknownDurationPlays,1);
        assert.equal(weighted.unknownPrivacyPlays,1);
        const all = await getWrappedArtists('2000-01-01','2000-01-31',20,'all');
        assert.equal(all.artists.find(a=>a.name==='Guest').score,3);
        const primary = await getWrappedArtists('2000-01-01','2000-01-31',20,'primary');
        assert.deepEqual(primary.artists.map(a=>a.name),['Lead','Fallback']);
        const normal = await getWrappedArtists('2000-01-01','2000-01-31',20,'all',false);
        assert.equal(normal.totalPlays,7);
        const empty = await getWrappedArtists('1990-01-01','1990-01-31');
        assert.equal(empty.totalPlays,0); assert.deepEqual(empty.artists,[]);
        console.log('SQL regression tests passed: decimal weights, stable fractional ordering, duplicate credits, missing metadata, private/short plays, unknown fields, bounds and empty range.');
      });
    } finally {await sql.end();}
  })().catch(e=>{console.error(e.code ?? e.name,e.message);process.exitCode=1;});
}
