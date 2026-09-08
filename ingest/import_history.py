"""Import/reconcile Extended Streaming History without duplicating tracker plays."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import psycopg2
from ingest.migrate import load_local_env
from ingest.storage import store_plays


def export_play(item):
    if not isinstance(item, dict):
        return None
    if not item.get('master_metadata_track_name') or not item.get('master_metadata_album_artist_name') or not item.get('ts'):
        return None
    ms = item.get('ms_played')
    if not isinstance(ms, int) or ms < 30000:
        return None
    uri = item.get('spotify_track_uri') or ''
    return dict(track_name=item['master_metadata_track_name'], artist_name=item['master_metadata_album_artist_name'],
                album_name=item.get('master_metadata_album_album_name'), played_at=item['ts'],
                spotify_id=uri.split(':')[-1] if uri.startswith('spotify:track:') else None,
                ms_played=ms, skipped=item.get('skipped'), offline=item.get('offline'), source='export')


def main():
    import os
    load_local_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', type=Path, default=ROOT / 'Spotify Extended Streaming History')
    args = parser.parse_args()
    files = sorted(args.directory.expanduser().glob('*.json'))
    if not files:
        parser.error('No JSON history files found')
    conn = psycopg2.connect(os.environ['DB_URI'], connect_timeout=15)
    inserted = 0
    failed = []
    try:
        for path in files:
            try:
                data = json.loads(path.read_text())
                if not isinstance(data, list):
                    continue
                plays = [play for item in data if (play := export_play(item))]
                with conn.cursor() as cur:
                    count = store_plays(cur, plays)
                conn.commit()
                inserted += count
                print(f'{path.name}: {len(plays)} reconciled, {count} inserted')
            except Exception as exc:
                conn.rollback()
                failed.append(path.name)
                print(f'{path.name}: failed ({type(exc).__name__}); rolled back')
    finally:
        conn.close()
    print(f'Inserted: {inserted}; failed files: {len(failed)}')
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
