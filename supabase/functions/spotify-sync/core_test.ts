import assert from "node:assert/strict";
import {
  authorized,
  deduplicate,
  fetchHistory,
  type HistoryItem,
  incomplete,
  prepare,
} from "./core.ts";

const base = Date.parse("2026-10-14T12:00:00Z");
function item(minutes: number, id = "track-a"): HistoryItem {
  return {
    played_at: new Date(base + minutes * 60_000).toISOString(),
    track: {
      id,
      name: "Joint song (feat. Guest)",
      duration_ms: 200_000,
      artists: [{ id: "a", name: "Lead" }, { id: "b", name: "Guest" }, {
        id: "b",
        name: "Guest",
      }],
      album: { id: "album", name: "Album", images: [{ url: "cover" }] },
    },
  };
}

Deno.test("Offline tracks at one timestamp survive; API/export rounding duplicates do not", () => {
  const { plays, credits } = prepare([
    item(0),
    item(0, "track-b"),
    item(0),
    item(1),
  ]);
  assert.equal(plays.length, 3);
  assert.equal(credits.length, 4);
  assert.deepEqual(
    credits.filter((c) => c.spotify_id === "track-a").map((c) => c.artist_id),
    ["a", "b"],
  );
  assert.equal(plays[0].source, "api");
  assert.equal("ms_played" in plays[0], false);
  assert.equal(plays[0].image_url, "cover");
  const close = { ...plays[0], played_at: new Date(base + 514).toISOString() };
  assert.equal(deduplicate([plays[0], close]).length, 1);
  assert.equal(
    deduplicate([plays[0], {
      ...close,
      played_at: new Date(base + 31_000).toISOString(),
    }]).length,
    2,
  );
});

Deno.test("Joint billing is retained and duplicate artist IDs are removed", () => {
  const play = item(0);
  play.track.name = "Young, Wild & Free (feat. Bruno Mars)";
  play.track.artists = [{ id: "s", name: "Snoop Dogg" }, {
    id: "w",
    name: "Wiz Khalifa",
  }, { id: "b", name: "Bruno Mars" }];
  assert.deepEqual(prepare([play]).credits.map((c) => c.is_featured), [
    false,
    false,
    true,
  ]);
});

Deno.test("Normal pagination uses Spotify's cursor and stops after two overlapping pages", async () => {
  const calls: (number | undefined)[] = [];
  const pages = [[item(20), item(10)], [item(0), item(-1)], [
    item(-2),
    item(-3),
  ]];
  const result = await fetchHistory((before) => {
    calls.push(before);
    return Promise.resolve({
      items: pages.shift(),
      cursors: { before: String(base - calls.length * 60_000) },
    });
  }, { cutoff: base - 7 * 86400_000, watermark: base, recovery: false });
  assert.equal(result.pages, 3);
  assert.equal(result.stopReason, "database overlap reached");
  assert.equal(calls[0], undefined);
  assert.equal(calls[1], base - 60_000);
  assert.equal(result.items.length, 6);
});

Deno.test("Recovery ignores watermark and includes the lookback boundary", async () => {
  const pages = [[item(20), item(10)], [item(0), item(-1)], [
    item(-2),
    item(-3),
  ], [item(-5)]];
  const result = await fetchHistory(
    () => Promise.resolve({ items: pages.shift() }),
    { cutoff: base - 3 * 60_000, watermark: base, recovery: true },
  );
  assert.equal(result.pages, 3);
  assert.equal(result.items.length, 6);
  assert.equal(result.stopReason, "lookback boundary reached");
});

Deno.test("Repeated cursors, malformed timestamps, page caps and unavailable older history terminate safely", async () => {
  let count = 0;
  const repeated = await fetchHistory(
    () =>
      Promise.resolve({ items: [item(-++count)], cursors: { before: "123" } }),
    { cutoff: 0, watermark: null, recovery: true },
  );
  assert.equal(repeated.pages, 2);
  assert.equal(repeated.stopReason, "cursor stopped advancing");
  const invalid = await fetchHistory(
    () => Promise.resolve({ items: [{ ...item(0), played_at: "invalid" }] }),
    { cutoff: 0, watermark: null, recovery: false },
  );
  assert.equal(invalid.items.length, 0);
  assert.equal(invalid.stopReason, "page contained no valid timestamps");
  const limited = await fetchHistory(
    () => Promise.resolve({ items: [item(0)] }),
    { cutoff: 0, watermark: null, recovery: true, maxPages: 1 },
  );
  assert.ok(incomplete(limited, null));
  assert.ok(
    incomplete({
      items: Array.from({ length: 50 }, (_, i) => item(i)),
      pages: 2,
      stopReason: "no more Spotify history",
    }, base - 60_000),
  );
});

Deno.test("Trigger credentials reject missing, wrong, short and different tokens", async () => {
  const secret = "0123456789abcdef".repeat(4);
  assert.equal(await authorized(null, secret), false);
  assert.equal(await authorized("Bearer wrong", secret), false);
  assert.equal(await authorized("Bearer " + secret, secret), true);
  assert.equal(await authorized("Bearer " + secret + "x", secret), false);
  assert.equal(await authorized("Bearer short", "short"), false);
});
