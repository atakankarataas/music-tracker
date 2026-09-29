"""Populate catalogue credits. Title-derived guest flags are heuristics only.
Spotify's track artist order does not identify primary/featured billing roles.
"""
import os
import re
import sys
import unicodedata
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import psycopg2
import requests
from psycopg2.extras import execute_values

from ingest.migrate import load_local_env

# Optional title hint, not authoritative billing metadata. Wrapped does not
# infer a verified guest role from this flag.
GUESTS = re.compile(r"[\(\[]\s*(?:feat|ft|with)[\.\s]([^)\]]*)[\)\]]", re.I)
TOKEN_URL = "https://accounts.spotify.com/api/token"


def normalise(value):
    """Fold accents and stylised spelling so "Too $hort" matches "Too Short"."""
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", " ", folded.replace("$", "s").replace("&", " "))


def is_guest(title_names, artist):
    """True when the title lists this artist as a guest.

    Flagging every secondary artist instead would demote real co-primaries:
    on "Young, Wild & Free (feat. Bruno Mars)" only Bruno Mars is the guest,
    while Wiz Khalifa shares the billing with Snoop Dogg.
    """
    listed, name = normalise(title_names), normalise(artist)
    if name.strip() and name in listed:
        return True
    words = [word for word in name.split() if len(word) > 2]
    return bool(words) and all(word in listed for word in words)


def access_token(force_refresh=False):
    import json
    from datetime import datetime, timezone

    cache_path = Path(os.environ.get("SPOTIPY_CACHE_PATH", str(ROOT / ".cache")))
    raw_cache = os.environ.get("SPOTIPY_CACHE")
    cache = json.loads(raw_cache) if raw_cache else json.loads(cache_path.read_text()) if cache_path.exists() else {}
    if not force_refresh and cache.get("expires_at", 0) > datetime.now(timezone.utc).timestamp() + 60:
        return cache["access_token"]
    refresh_token = os.environ.get("SPOTIFY_REFRESH_TOKEN") or cache.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("A Spotify refresh token or SPOTIPY_CACHE is required")
    response = requests.post(
        TOKEN_URL,
        auth=(os.environ["SPOTIPY_CLIENT_ID"], os.environ["SPOTIPY_CLIENT_SECRET"]),
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
        timeout=20,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def rows_for(track_id, track):
    """One row per credited artist. Position 0 is first in catalogue order."""
    if not track:
        return []
    match = GUESTS.search(track.get("name") or "")
    listed = match.group(1) if match else ""
    seen = set()
    rows = []
    for index, artist in enumerate(track.get("artists") or []):
        if not artist or not artist.get("id") or not artist.get("name") or artist["id"] in seen:
            continue
        seen.add(artist["id"])
        rows.append((track_id, index, artist["id"], artist["name"],
                     bool(listed) and index > 0 and is_guest(listed, artist["name"])))
    return rows


def main():
    load_local_env()
    limit = int(os.environ.get("TRACK_ARTIST_LIMIT", "20000"))
    connection = psycopg2.connect(os.environ["DB_URI"], connect_timeout=20)
    with connection.cursor() as cursor:
        cursor.execute(
            """SELECT DISTINCT s.spotify_id FROM public.scrobbles s
               WHERE s.spotify_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM public.music_track_artists t WHERE t.spotify_id = s.spotify_id)
               LIMIT %s""",
            (limit,),
        )
        pending = [row[0] for row in cursor.fetchall()]
    print(f"{len(pending)} tracks need artist credits")
    if not pending:
        connection.close()
        return

    headers = {"Authorization": f"Bearer {access_token()}"}
    stored = 0
    failed = 0
    deadline = time.monotonic() + int(os.environ.get("TRACK_ARTIST_TIME_BUDGET_SECONDS", "120"))
    batch_supported = True

    def fetch(url, params=None):
        for attempt in range(3):
            if time.monotonic() >= deadline:
                raise TimeoutError("Artist-credit time budget exhausted")
            response = requests.get(url, headers=headers, params=params, timeout=15)
            if response.status_code == 401 and attempt == 0:
                headers["Authorization"] = f"Bearer {access_token(force_refresh=True)}"
                continue
            if response.status_code == 429:
                wait = max(1, int(response.headers.get("Retry-After", "2")))
                if wait > 30 or time.monotonic() + wait >= deadline:
                    raise TimeoutError("Spotify rate limit exceeds this run's budget")
                time.sleep(wait)
                continue
            return response
        raise RuntimeError("Spotify authorization or rate limit did not recover")

    try:
        for offset in range(0, len(pending), 50):
            if time.monotonic() >= deadline:
                break
            batch = pending[offset:offset + 50]
            tracks = None
            if batch_supported:
                response = fetch("https://api.spotify.com/v1/tracks", {"ids": ",".join(batch)})
                if response.status_code in (400, 403, 404):
                    batch_supported = False
                else:
                    response.raise_for_status()
                    tracks = response.json()["tracks"]
            if tracks is None:
                tracks = []
                for track_id in batch:
                    response = fetch(f"https://api.spotify.com/v1/tracks/{track_id}")
                    if response.status_code == 404:
                        tracks.append(None)
                    else:
                        response.raise_for_status()
                        tracks.append(response.json())
            rows = []
            for track_id, track in zip(batch, tracks):
                rows.extend(rows_for(track_id, track))
            if rows:
                with connection.cursor() as cursor:
                    execute_values(
                        cursor,
                        """INSERT INTO public.music_track_artists
                           (spotify_id, position, artist_id, artist_name, is_featured)
                           VALUES %s ON CONFLICT (spotify_id, position) DO UPDATE SET
                             artist_id = excluded.artist_id, artist_name = excluded.artist_name,
                             is_featured = excluded.is_featured, fetched_at = now()""",
                        rows, page_size=500,
                    )
                connection.commit()
                stored += len(rows)
            time.sleep(0.05)
    except (requests.RequestException, RuntimeError, TimeoutError) as exc:
        connection.rollback()
        failed = 1
        print(f"Artist enrichment stopped ({type(exc).__name__}); completed batches retained.")
    finally:
        connection.close()
    print(f"stored {stored} artist credits")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
