"""Restore export Private Session flags on existing plays without adding plays."""
import bisect
import collections
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import psycopg2
from psycopg2.extras import execute_values
from ingest.migrate import load_local_env
from ingest.storage import parse_time


def main():
    load_local_env()
    directory = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'Spotify Extended Streaming History'
    exports = collections.defaultdict(list)
    for path in sorted(directory.glob('*.json')):
        for item in json.loads(path.read_text()):
            uri = item.get('spotify_track_uri') or ''
            if uri.startswith('spotify:track:') and isinstance(item.get('incognito_mode'), bool):
                exports[uri.split(':')[-1]].append((parse_time(item['ts']).timestamp(), item['incognito_mode']))
    if not exports:
        raise RuntimeError('No export privacy flags found')
    for rows in exports.values():
        rows.sort()
    with psycopg2.connect(os.environ['DB_URI'], connect_timeout=15) as conn:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '30s'")
            cur.execute('SELECT id,spotify_id,played_at,incognito_mode FROM scrobbles WHERE spotify_id IS NOT NULL')
            updates = []
            for row_id,track,at,flag in cur.fetchall():
                records = exports.get(track, [])
                stamp = at.timestamp()
                lo = bisect.bisect_left(records, (stamp-3, False))
                hi = bisect.bisect_right(records, (stamp+3, True))
                if lo < hi:
                    private = any(p for _,p in records[lo:hi])
                    if flag is None or flag != private:
                        updates.append((row_id, private))
            conn.commit()
            total = 0
            # Small resumable batches avoid a long archive-wide update lock.
            for offset in range(0, len(updates), 1000):
                cur.execute('SELECT pg_advisory_xact_lock(734201911)')
                execute_values(cur, """UPDATE scrobbles s SET incognito_mode=v.private
                    FROM (VALUES %s) v(id,private) WHERE s.id=v.id""",
                    updates[offset:offset+1000], page_size=1000)
                total += cur.rowcount
                conn.commit()
                if offset % 10000 == 0:
                    print(f'Privacy flags: {total}/{len(updates)}', flush=True)
            print(f'Restored privacy flags for {total} existing plays.')


if __name__ == '__main__':
    main()
