import os
from datetime import datetime, timedelta, timezone

import psycopg2
import spotipy
from spotipy.oauth2 import SpotifyOAuth

from ingest.spotify_auth import SPOTIFY_SCOPES
from ingest.storage import store_plays


def load_env_file():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as env_file:
        for line in env_file:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def require_env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def infer_mood(track_name="", genres=None):
    text = f"{track_name or ''} {' '.join(genres or [])}".lower()
    if any(word in text for word in ("dance", "disco", "funk", "club", "house", "party")):
        return "Upbeat"
    if any(word in text for word in ("sad", "emo", "melanch", "blues", "heartbreak", "lonely")):
        return "Melancholy"
    if any(word in text for word in ("ambient", "chill", "lo-fi", "lofi", "dream", "sleep")):
        return "Chill"
    if any(word in text for word in ("metal", "punk", "rock", "rage", "hardcore")):
        return "High Energy"
    if any(word in text for word in ("r&b", "soul", "jazz", "romance", "love")):
        return "Warm"
    return "Mixed"


def chunked(values, size):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def env_int(name, default, minimum=1, maximum=100):
    raw_value = os.environ.get(name)
    if raw_value is None or not raw_value.strip():
        value = default
    else:
        try:
            value = int(raw_value)
        except ValueError as exc:
            raise RuntimeError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def env_bool(name, default=False):
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    normalized = raw_value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off", ""}:
        return False
    raise RuntimeError(f"{name} must be true or false")


def normalize_datetime(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def timestamp_millis(value):
    normalized = normalize_datetime(value)
    if normalized is None:
        return None
    return int(normalized.timestamp() * 1000)


def fetch_recent_history(
    sp,
    cutoff,
    last_played_at=None,
    max_pages=20,
    overlap_pages=2,
    force_recovery=False,
):
    """Fetch recent plays newest-to-oldest with bounded cursor pagination.

    Normal runs stop after enough pages overlap the current database watermark.
    Recovery runs ignore that shortcut and scan the whole lookback window. This
    matters for offline plays that Spotify uploads later with an older
    ``played_at`` value.
    """
    cutoff = normalize_datetime(cutoff)
    last_played_at = normalize_datetime(last_played_at)
    if cutoff is None:
        raise RuntimeError("A valid sync cutoff is required")

    collected = {}
    before = None
    seen_cursors = set()
    overlap_count = 0
    pages_scanned = 0
    stop_reason = "page limit"

    for _ in range(max_pages):
        request = {"limit": 50}
        if before is not None:
            request["before"] = before

        results = sp.current_user_recently_played(**request)
        pages_scanned += 1
        items = results.get("items") or []
        if not items:
            stop_reason = "no more Spotify history"
            break

        dated_items = []
        for item in items:
            played_at = normalize_datetime(item.get("played_at"))
            if played_at is None:
                continue
            dated_items.append((played_at, item))
            if played_at >= cutoff:
                track = item.get("track") or {}
                artists = track.get("artists") or []
                identity = track.get("id") or (track.get("name"), tuple(a.get("name") for a in artists))
                collected[(timestamp_millis(played_at), identity)] = item

        if not dated_items:
            stop_reason = "page contained no valid timestamps"
            break

        oldest = min(played_at for played_at, _ in dated_items)
        if oldest <= cutoff:
            stop_reason = "lookback boundary reached"
            break

        if not force_recovery and last_played_at is not None and oldest <= last_played_at:
            overlap_count += 1
            if overlap_count >= overlap_pages:
                stop_reason = "database overlap reached"
                break

        spotify_before = (results.get("cursors") or {}).get("before")
        try:
            next_before = int(spotify_before) if spotify_before is not None else timestamp_millis(oldest)
        except (TypeError, ValueError):
            next_before = timestamp_millis(oldest)
        if next_before is None or next_before in seen_cursors:
            stop_reason = "cursor stopped advancing"
            break
        seen_cursors.add(next_before)
        before = next_before

    ordered_items = sorted(
        collected.values(),
        key=lambda item: normalize_datetime(item.get("played_at")),
    )
    return ordered_items, pages_scanned, stop_reason


def get_sync_watermark(cur):
    cur.execute("SELECT MAX(played_at) FROM scrobbles;")
    row = cur.fetchone()
    return normalize_datetime(row[0]) if row and row[0] else None


def get_existing_timestamps(cur, cutoff):
    cur.execute("SELECT played_at FROM scrobbles WHERE played_at >= %s;", (cutoff,))
    existing = set()
    for row in cur.fetchall():
        played_at = timestamp_millis(row[0])
        if played_at is not None:
            existing.add(played_at)
    return existing


def fetch_artist_genres(sp, artist_ids):
    genres_by_artist = {}
    ids = [artist_id for artist_id in dict.fromkeys(artist_ids) if artist_id]
    for batch in chunked(ids, 50):
        response = {"artists": [sp.artist(artist_id) for artist_id in batch]}
        for artist in response.get("artists", []):
            if artist and artist.get("id"):
                genres_by_artist[artist["id"]] = artist.get("genres") or []
    return genres_by_artist


def run_sync():
    load_env_file()
    db_uri = require_env("DB_URI")
    client_id = require_env("SPOTIPY_CLIENT_ID")
    client_secret = require_env("SPOTIPY_CLIENT_SECRET")
    redirect_uri = os.environ.get("SPOTIPY_REDIRECT_URI", "http://127.0.0.1:8888/callback")
    cache_path = os.environ.get("SPOTIPY_CACHE_PATH", ".cache")
    lookback_days = env_int("SPOTIFY_SYNC_LOOKBACK_DAYS", 7, 1, 30)
    max_pages = env_int("SPOTIFY_SYNC_MAX_PAGES", 20, 1, 100)
    overlap_pages = env_int("SPOTIFY_SYNC_OVERLAP_PAGES", min(2, max_pages), 1, max_pages)
    force_recovery = env_bool("SPOTIFY_SYNC_FORCE_RECOVERY")

    token_info = os.environ.get("SPOTIPY_CACHE")
    if token_info:
        with open(cache_path, "w", encoding="utf-8") as cache_file:
            cache_file.write(token_info)

    sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        scope=SPOTIFY_SCOPES,
        cache_path=cache_path,
    ))

    conn = psycopg2.connect(db_uri)
    cur = conn.cursor()
    cur.execute("INSERT INTO public.music_sync_runs(status,mode,github_run_id) VALUES (%s,%s,%s) RETURNING id",
                ("running", "recovery" if force_recovery else "normal", os.environ.get("GITHUB_RUN_ID")))
    run_id = cur.fetchone()[0]
    conn.commit()
    last_played_at = get_sync_watermark(cur)
    anchor = last_played_at or datetime.now(timezone.utc)
    cutoff = anchor - timedelta(days=lookback_days)

    mode = "derin kurtarma" if force_recovery else "normal"
    print(
        f"Spotify'a bağlanıldı. {mode} taraması başlıyor: "
        f"{cutoff.isoformat()} sonrasındaki kayıtlar kontrol edilecek."
    )
    history, pages_scanned, stop_reason = fetch_recent_history(
        sp,
        cutoff=cutoff,
        last_played_at=last_played_at,
        max_pages=max_pages,
        overlap_pages=overlap_pages,
        force_recovery=force_recovery,
    )

    results = history
    print(f"{pages_scanned} pages; {len(history)} records; stop: {stop_reason}")
    prepared = []
    artist_ids = []
    for item in results:
        track = item.get("track") or {}
        album = track.get("album") or {}
        artists = track.get("artists") or []
        primary_artist = artists[0] if artists else {}
        images = album.get("images") or []

        track_name = track.get("name")
        artist_name = primary_artist.get("name")
        album_name = album.get("name")
        played_at = item.get("played_at")
        spotify_id = track.get("id")
        album_id = album.get("id")
        artist_id = primary_artist.get("id")
        image_url = images[1]["url"] if len(images) > 1 else images[0]["url"] if images else None

        if not track_name or not artist_name or not album_name or not played_at:
            continue

        artist_ids.append(artist_id)
        prepared.append({
            "track_name": track_name,
            "artist_name": artist_name,
            "album_name": album_name,
            "played_at": played_at,
            "spotify_id": spotify_id,
            "image_url": image_url,
            "album_id": album_id,
            "artist_id": artist_id,
            "duration_ms": track.get("duration_ms"),
            "source": "api",
        })

    inserted_count = store_plays(cur, prepared)
    # Commit the listening history before optional enrichment or reporting.
    conn.commit()
    oldest_fetched = min((normalize_datetime(p["played_at"]) for p in prepared), default=None)
    overlaps_archive = bool(last_played_at and oldest_fetched and oldest_fetched <= last_played_at)
    warning = stop_reason == "page limit" or (len(history) >= 50 and not overlaps_archive
        and stop_reason == "no more Spotify history")
    newest = max((normalize_datetime(p["played_at"]) for p in prepared), default=last_played_at)
    cur.execute("""UPDATE public.music_sync_runs SET finished_at=now(),status=%s,pages=%s,
      fetched=%s,inserted=%s,newest_play=%s,stop_reason=%s WHERE id=%s""",
      ("warning" if warning else "success",pages_scanned,len(history),inserted_count,newest,stop_reason,run_id))
    conn.commit()
    cur.close()
    conn.close()
    print(f"Saved {inserted_count} new plays. Metadata enrichment runs separately.")
    if warning:
        print("::warning::Spotify history window may be incomplete; inspect sync status and reconcile an export.")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as file:
            file.write(f"## Spotify sync\n\nPages: {pages_scanned} · fetched: {len(history)} · inserted: {inserted_count}\n\nStop: {stop_reason}\n")


def main():
    try:
        run_sync()
    except Exception as exc:
        # Persist sanitized diagnostics. Never print credential-bearing DB errors.
        try:
            with psycopg2.connect(require_env("DB_URI"), connect_timeout=10) as conn:
                with conn.cursor() as cur:
                    cur.execute("""UPDATE public.music_sync_runs SET status='failed',finished_at=now(),error_code=%s
                      WHERE id=(SELECT id FROM public.music_sync_runs WHERE status='running'
                        AND github_run_id IS NOT DISTINCT FROM %s ORDER BY started_at DESC LIMIT 1)""",
                      (type(exc).__name__,os.environ.get("GITHUB_RUN_ID")))
        except Exception:
            pass
        print(f"::error::Spotify sync failed ({type(exc).__name__}).")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
