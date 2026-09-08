"""Opt-in PostgreSQL reconciliation test. All fixture writes are rolled back."""
import os
import unittest
import uuid
import psycopg2
from ingest.storage import store_plays


@unittest.skipUnless(os.environ.get('MUSIC_TEST_DATABASE') == '1', 'opt-in database test')
class StorageDatabaseTests(unittest.TestCase):
    def test_shared_timestamps_and_cross_source_replay(self):
        conn = psycopg2.connect(os.environ['DB_URI'], connect_timeout=15)
        prefix = 'test-' + uuid.uuid4().hex
        def play(track, timestamp, source, **extra):
            return dict(track_name=prefix+track, artist_name=prefix, album_name=prefix,
                        spotify_id=prefix+track, played_at=timestamp, source=source, **extra)
        try:
            with conn.cursor() as cur:
                batch = [play(key, '1901-01-01T00:00:00Z', 'export', ms_played=45000)
                         for key in ('a', 'b')]
                self.assertEqual(store_plays(cur, batch), 2)
                self.assertEqual(store_plays(cur, batch), 0)
                self.assertEqual(store_plays(cur, [play('a', '1901-01-01T00:00:00.514Z', 'tracker')]), 0)
                cur.execute('SELECT ms_played,ingest_sources FROM scrobbles WHERE spotify_id=%s', (prefix+'a',))
                duration, sources = cur.fetchone()
                self.assertEqual(duration, 45000)
                self.assertEqual(set(sources), {'export', 'tracker'})
                self.assertEqual(store_plays(cur, [play('c', '1901-01-01T00:01:00.514Z', 'tracker')]), 1)
                self.assertEqual(store_plays(cur, [play('c', '1901-01-01T00:01:00Z', 'export', ms_played=60000)]), 0)
        finally:
            conn.rollback()
            conn.close()
