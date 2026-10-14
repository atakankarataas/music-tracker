import assert from "node:assert/strict";
import postgres from "npm:postgres@3.4.9";
import type { Sql } from "npm:postgres@3.4.9";
import { type HistoryItem, prepare } from "./core.ts";
import { storeBatch } from "./storage.ts";

Deno.test({
  name: "SQL reconciliation, replay and export privacy/duration preservation",
  ignore: Deno.env.get("MUSIC_TEST_DATABASE") !== "1",
  fn: async () => {
    const sql = postgres(Deno.env.get("WEB_DB_URI")!, {
      ssl: "require",
      prepare: false,
      max: 1,
      connect_timeout: 15,
    });
    try {
      await sql.begin(async (tx) => {
        await tx`CREATE TEMP TABLE scrobbles(id bigserial PRIMARY KEY,track_name text,artist_name text,album_name text,
      played_at timestamptz,spotify_id text,image_url text,album_id text,artist_id text,duration_ms integer,
      ms_played integer,incognito_mode boolean,skipped boolean,offline boolean,ingest_sources text[] DEFAULT '{}',
      UNIQUE NULLS NOT DISTINCT(played_at,spotify_id)) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE music_track_artists(spotify_id text,position smallint,artist_id text,artist_name text,
      is_featured boolean,fetched_at timestamptz DEFAULT now(),PRIMARY KEY(spotify_id,position)) ON COMMIT DROP`;
        const scoped = new Proxy(
          function (strings: TemplateStringsArray, ...values: unknown[]) {
            const safe = strings.map((s) =>
              s.replaceAll("public.scrobbles", "pg_temp.scrobbles").replaceAll(
                "public.music_track_artists",
                "pg_temp.music_track_artists",
              )
            );
            return tx(
              Object.assign(safe, {
                raw: safe,
              }) as unknown as TemplateStringsArray,
              ...values as never[],
            );
          },
          {
            get(_target, key) {
              if (key === "begin") {
                return (callback: (value: Sql) => Promise<number>) =>
                  callback(scoped as unknown as Sql);
              }
              const value = Reflect.get(tx, key);
              return typeof value === "function" ? value.bind(tx) : value;
            },
          },
        ) as unknown as Sql;
        const sample = (id: string, at: string): HistoryItem => ({
          played_at: at,
          track: {
            id,
            name: "Song",
            artists: [{ id: "a", name: "Lead" }, { id: "b", name: "Guest" }],
            album: { id: "album", name: "Album" },
            duration_ms: 200000,
          },
        });
        const initial = prepare([
          sample("one", "2026-01-01T00:00:00Z"),
          sample("two", "2026-01-01T00:00:00Z"),
        ]);
        assert.equal(
          await storeBatch(scoped, initial.plays, initial.credits),
          2,
        );
        assert.equal(
          await storeBatch(scoped, initial.plays, initial.credits),
          0,
        );
        await tx`UPDATE pg_temp.scrobbles SET ms_played=45678,incognito_mode=true,skipped=true,offline=true,ingest_sources=ARRAY['export'] WHERE spotify_id='one'`;
        const replay = prepare([sample("one", "2026-01-01T00:00:00.514Z")]);
        assert.equal(await storeBatch(scoped, replay.plays, replay.credits), 0);
        const [row] =
          await tx`SELECT ms_played,incognito_mode,skipped,offline,ingest_sources FROM pg_temp.scrobbles WHERE spotify_id='one'`;
        assert.equal(row.ms_played, 45678);
        assert.ok(row.incognito_mode && row.skipped && row.offline);
        assert.deepEqual([...row.ingest_sources].sort(), ["api", "export"]);
        assert.equal(
          (await tx`SELECT * FROM pg_temp.music_track_artists WHERE spotify_id='one'`)
            .length,
          2,
        );
        const changed = prepare([{
          ...sample("one", "2026-01-01T00:01:00Z"),
          track: {
            ...sample("one", "2026-01-01T00:01:00Z").track,
            artists: [{ id: "a", name: "Lead" }],
          },
        }]);
        assert.equal(
          await storeBatch(scoped, changed.plays, changed.credits),
          1,
        );
        assert.equal(
          (await tx`SELECT * FROM pg_temp.music_track_artists WHERE spotify_id='one'`)
            .length,
          1,
        );
      });
    } finally {
      await sql.end();
    }
  },
});
