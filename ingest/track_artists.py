"""Populate music_track_artists so a play can credit every artist on the track.

Spotify's track object lists artists in order but never marks which are guests,
so the only available signal is the title: a name introduced by "(feat. ...)"
is a guest. Calibrating against eight years of real Wrapped results showed a
co-primary artist is credited in full and a guest only marginally, which is why
the flag is stored rather than recomputed at query time.
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

# Spotify names guests in the title, so the parenthetical is the only signal for
# which of the credited artists are guests rather than co-primaries.
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


def access_token():
    import json
    from datetime import datetime, timezone

    cache = json.loads((ROOT / ".cache").read_text())
    if cache.get("expires_at", 0) > datetime.now(timezone.utc).timestamp() + 60:
        return cache["access_token"]
    response = requests.post(
        TOKEN_URL,
        auth=(os.environ["SPOTIPY_CLIENT_ID"], os.environ["SPOTIPY_CLIENT_SECRET"]),
        data={
            "grant_type": "refresh_token",
            "refresh_token": os.environ.get("SPOTIFY_REFRESH_TOKEN") or cache["refresh_token"],
        },
        timeout=20,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def rows_for(track_id, track):
    """One row per credited artist. Position 0 is the primary artist."""
    if not track:
        return []
    match = GUESTS.search(track.get("name") or "")
    listed = match.group(1) if match else ""
    return [
        (track_id, index, artist["id"], artist["name"],
         bool(listed) and index > 0 and is_guest(listed, artist["name"]))
        for index, artist in enumerate(track.get("artists") or [])
        if artist and artist.get("id")
    ]


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

    token = access_token()
    headers = {"Authorization": f"Bearer {token}"}
    stored = 0
    for offset in range(0, len(pending), 50):
        batch = pending[offset:offset + 50]
        for _ in range(4):
            response = requests.get(
                "https://api.spotify.com/v1/tracks",
                headers=headers, params={"ids": ",".join(batch)}, timeout=25,
            )
            if response.status_code == 200:
                break
            if response.status_code == 401:
                headers = {"Authorization": f"Bearer {access_token()}"}
            elif response.status_code == 429:
                time.sleep(int(response.headers.get("Retry-After", "2")) + 1)
            else:
                time.sleep(2)
        else:
            print(f"batch at {offset} failed; continuing")
            continue

        rows = []
        for track_id, track in zip(batch, response.json()["tracks"]):
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
    connection.close()
    print(f"stored {stored} artist credits")


if __name__ == "__main__":
    main()
