import postgres from "npm:postgres@3.4.9";
import {
  authorized,
  fetchHistory,
  type HistoryPage,
  incomplete,
  prepare,
  time,
} from "./core.ts";
import { storeBatch } from "./storage.ts";

let tokenCache: { value: string; expires: number } | undefined;

function client() {
  const uri = Deno.env.get("MUSIC_TRACKER_DB_URI") ??
    Deno.env.get("SUPABASE_DB_URL");
  if (!uri) throw new Error("DatabaseConfiguration");
  return postgres(uri, {
    ssl: "require",
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    connection: {
      application_name: "music-supabase-tracker",
      statement_timeout: 15_000,
      lock_timeout: 5_000,
    },
  });
}

export async function handler(request: Request): Promise<Response> {
  // Reject absent credentials before touching the database.
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let sql: ReturnType<typeof client>;
  try {
    sql = client();
  } catch {
    return Response.json({ error: "DatabaseConfiguration" }, { status: 503 });
  }
  const owner = crypto.randomUUID();
  let lease = false, runId: number | null = null;
  const deadline = Date.now() + 110_000;
  try {
    const [key] =
      await sql`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='music_tracker_trigger_secret'`;
    if (
      !await authorized(
        request.headers.get("authorization"),
        key?.decrypted_secret ?? "",
      )
    ) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, {
        status: 405,
        headers: { Allow: "POST" },
      });
    }
    const raw = await request.text();
    if (raw.length > 1024) {
      return Response.json({ error: "Request too large" }, { status: 413 });
    }
    let body: { recovery?: boolean; dry_run?: boolean };
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (
      !body || typeof body !== "object" || Array.isArray(body) ||
      body.recovery !== undefined && typeof body.recovery !== "boolean" ||
      body.dry_run !== undefined && typeof body.dry_run !== "boolean"
    ) return Response.json({ error: "Invalid options" }, { status: 400 });
    const claims =
      await sql`INSERT INTO public.music_sync_lease(singleton,owner,expires_at)
      VALUES(true,${owner},now()+interval '150 seconds')
      ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
      WHERE music_sync_lease.expires_at<now() RETURNING owner`;
    if (!claims.length) {
      return Response.json({
        status: "skipped",
        reason: "Another sync is running",
      });
    }
    lease = true;
    const recovery = body.recovery === true;
    if (!body.dry_run) {
      const [run] =
        await sql`INSERT INTO public.music_sync_runs(status,mode,source)
        VALUES('running',${
          recovery ? "recovery" : "normal"
        },'supabase_edge') RETURNING id`;
      runId = Number(run.id);
    }
    const secretRows =
      await sql`SELECT name,decrypted_secret FROM vault.decrypted_secrets
      WHERE name IN('music_spotify_client_id','music_spotify_client_secret','music_spotify_refresh_token')`;
    const secrets = Object.fromEntries(
      secretRows.map((row) => [row.name, row.decrypted_secret as string]),
    );
    if (Object.keys(secrets).length !== 3) {
      throw new Error("SpotifyConfiguration");
    }
    async function token(force = false): Promise<string> {
      if (!force && tokenCache && tokenCache.expires > Date.now() + 60_000) {
        return tokenCache.value;
      }
      const result = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: "Basic " +
            btoa(
              secrets.music_spotify_client_id + ":" +
                secrets.music_spotify_client_secret,
            ),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: secrets.music_spotify_refresh_token,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!result.ok) throw new Error("SpotifyToken" + result.status);
      const value = await result.json();
      if (
        typeof value.access_token !== "string" ||
        !Number.isFinite(value.expires_in)
      ) throw new Error("SpotifyTokenResponse");
      if (
        typeof value.refresh_token === "string" &&
        value.refresh_token !== secrets.music_spotify_refresh_token
      ) {
        await sql`SELECT vault.update_secret(id,${value.refresh_token}) FROM vault.secrets WHERE name='music_spotify_refresh_token'`;
        secrets.music_spotify_refresh_token = value.refresh_token;
      }
      tokenCache = {
        value: value.access_token,
        expires: Date.now() + value.expires_in * 1000,
      };
      return tokenCache.value;
    }
    const [latest] =
      await sql`SELECT max(played_at)::text AS at FROM public.scrobbles`;
    const watermark = time(latest?.at);
    const history = await fetchHistory(async (before) => {
      const url = new URL(
        "https://api.spotify.com/v1/me/player/recently-played",
      );
      url.searchParams.set("limit", "50");
      if (before !== undefined) url.searchParams.set("before", String(before));
      for (let attempt = 0; attempt < 3; attempt++) {
        if (Date.now() + 15_000 >= deadline) throw new Error("SyncDeadline");
        const response = await fetch(url, {
          headers: { Authorization: "Bearer " + await token() },
          signal: AbortSignal.timeout(15_000),
        });
        if (response.status === 401 && attempt === 0) {
          await token(true);
          continue;
        }
        if (response.status === 429 && attempt < 2) {
          const seconds = Number(response.headers.get("retry-after") ?? "3");
          if (
            !Number.isFinite(seconds) || seconds > 20 ||
            Date.now() + (seconds + 15) * 1000 >= deadline
          ) throw new Error("SpotifyRateLimit");
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(1, seconds) * 1000)
          );
          continue;
        }
        if (!response.ok) throw new Error("SpotifyHistory" + response.status);
        return await response.json() as HistoryPage;
      }
      throw new Error("SpotifyRetriesExhausted");
    }, {
      cutoff: (watermark ?? Date.now()) - 7 * 86400_000,
      watermark,
      recovery,
    });
    const { plays, credits } = prepare(history.items);
    const inserted = body.dry_run ? 0 : await storeBatch(sql, plays, credits);
    const warning = incomplete(history, watermark);
    const newest = plays.at(-1)?.played_at ?? latest?.at ?? null;
    if (runId !== null) {
      await sql`UPDATE public.music_sync_runs SET status=${
        warning ? "warning" : "success"
      },
      finished_at=now(),pages=${history.pages},fetched=${history.items.length},inserted=${inserted},
      newest_play=${newest},stop_reason=${history.stopReason} WHERE id=${runId}`;
    }
    return Response.json({
      status: body.dry_run ? "dry_run" : warning ? "warning" : "success",
      pages: history.pages,
      fetched: history.items.length,
      inserted,
      credits: credits.length,
      stopReason: history.stopReason,
    });
  } catch (error) {
    // Error messages are our own labels only; never return/log DB or token data.
    const message = error instanceof Error &&
        /^(Spotify\w+|SyncDeadline|DatabaseConfiguration)$/.test(error.message)
      ? error.message
      : "SyncError";
    if (runId !== null) {
      try {
        await sql`UPDATE public.music_sync_runs SET status='failed',finished_at=now(),error_code=${message} WHERE id=${runId}`;
      } catch { /* Lease expiry allows the next scheduled retry. */ }
    }
    console.error("Spotify sync:", message);
    return Response.json({ error: message }, { status: 503 });
  } finally {
    if (lease) {
      try {
        await sql`DELETE FROM public.music_sync_lease WHERE singleton AND owner=${owner}`;
      } catch { /* Expiring lease handles worker termination. */ }
    }
    await sql.end({ timeout: 2 });
  }
}

Deno.serve(handler);
