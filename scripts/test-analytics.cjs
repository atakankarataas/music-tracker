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
          ms_played integer, incognito_mode boolean, played_at timestamptz,
          track_name text DEFAULT 'Song', album_name text DEFAULT 'Album', album_id text DEFAULT 'album') ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE music_track_artists (spotify_id text, artist_id text,
          artist_name text, position integer) ON COMMIT DROP`;
        await tx`INSERT INTO music_track_artists VALUES ('duet','a','Lead',0),('duet','b','Guest',1),('duet','b','Guest',2)`;
        await tx`CREATE TEMP TABLE mv_music_totals (first_play timestamptz) ON COMMIT DROP`;
        await tx`INSERT INTO mv_music_totals VALUES ('2000-01-01T00:00Z')`;
        await tx`INSERT INTO scrobbles (spotify_id,artist_name,image_url,ms_played,incognito_mode,played_at) VALUES
          ('duet','Lead',NULL,60000,false,'2000-01-01T00:00Z'),
          ('duet','Lead',NULL,60000,false,'2000-01-02T00:00Z'),
          ('duet','Lead',NULL,60000,false,'2000-01-03T00:00Z'),
          ('duet','Lead',NULL,60000,true,'2000-01-04T00:00Z'),
          ('duet','Lead',NULL,30000,false,'2000-01-05T00:00Z'),
          ('duet','Lead',NULL,29999,false,'2000-01-06T00:00Z'),
          ('missing','Fallback',NULL,NULL,NULL,'2000-01-07T00:00Z'),
          ('duet','Lead',NULL,60000,false,'2000-02-01T00:00Z')`;
        const scoped = (strings,...values) => {
          const safe = strings.map(s => s.replaceAll('public.scrobbles','pg_temp.scrobbles').replaceAll('public.music_track_artists','pg_temp.music_track_artists').replaceAll('public.mv_music_totals','pg_temp.mv_music_totals'));
          safe.raw = safe; return tx(safe,...values);
        };
        const original = Module._load;
        Module._load = (request,...rest) => request === 'server-only' ? {} : request === 'next/cache' ? {unstable_cache:fn=>fn} : request === '@/lib/db' ? {sql:scoped} : original(request,...rest);
        const filename = path.resolve('lib/wrapped.ts');
        const mod = new Module(filename,module); mod.paths=module.paths;
        mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
        Module._load = original;
        const {loadWrappedData} = mod.exports;
        const data = await loadWrappedData('2000-01-01','2000-01-31');
        assert.deepEqual(data.topArtists.map(a=>[a.name,a.plays]),[['Guest',3],['Lead',3],['Fallback',1]]);
        assert.equal(data.totalPlays,4); // Do not double-count collaborations in total plays.
        assert.equal(data.artists,3);
        assert.equal(data.tracks,2);
        assert.equal(data.activeDays,4);
        assert.equal(data.longestStreak,3);
        assert.deepEqual(data.activity,[{label:'Jan 00',value:4}]);
        assert.equal(data.dayparts.reduce((n,p)=>n+p.value,0),4);
        assert.deepEqual(data.topTracks.map(t=>t.plays),[3,1]);
        assert.deepEqual(data.topAlbums.map(t=>t.plays),[3,1]);
        // Istanbul winter midnight in 2000 is 22:00 UTC the previous day.
        await tx`INSERT INTO scrobbles (spotify_id,artist_name,ms_played,incognito_mode,played_at) VALUES
          ('duet','Lead',60000,false,'1999-12-31T22:00Z'),
          ('duet','Lead',60000,false,'1999-12-31T21:59:59Z'),
          ('duet','Lead',60000,false,'2000-01-31T22:00Z')`;
        assert.equal((await loadWrappedData('2000-01-01','2000-01-31')).totalPlays,5);
        const empty = await loadWrappedData('1990-01-01','1990-02-28');
        assert.equal(empty.totalPlays,0); assert.deepEqual(empty.topArtists,[]);
        assert.equal(empty.longestStreak,0); assert.equal(empty.activeDays,0);
        assert.deepEqual(empty.activity,[{label:'Jan 90',value:0},{label:'Feb 90',value:0}]);
        console.log('SQL regression tests passed: full joint credits, duplicate metadata, missing metadata, private/short plays, unknown fields, Istanbul bounds, streaks, monthly totals and empty ranges.');
      });
    } finally {await sql.end();}
  })().catch(e=>{console.error(e.code ?? e.name,e.message);process.exitCode=1;});
}
