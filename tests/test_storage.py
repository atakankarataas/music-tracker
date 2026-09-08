import unittest
from ingest.storage import deduplicate_batch
from ingest.import_history import export_play

def play(at, track='track-a'):
    return dict(played_at=at, spotify_id=track, track_name=track, artist_name='artist')

class StorageTests(unittest.TestCase):
    def test_rounding_duplicates_in_either_order(self):
        a=play('2026-01-01T00:00:00Z'); b=play('2026-01-01T00:00:00.514Z')
        self.assertEqual(len(deduplicate_batch([a,b])),1)
        self.assertEqual(len(deduplicate_batch([b,a])),1)

    def test_real_repeat_and_different_track_survive(self):
        self.assertEqual(len(deduplicate_batch([play('2026-01-01T00:00:00Z'),
            play('2026-01-01T00:00:00.5Z','track-b'),play('2026-01-01T00:00:31Z')])),3)

    def test_export_preserves_real_duration_and_skip(self):
        row=dict(master_metadata_track_name='Track',master_metadata_album_artist_name='Artist',
            ts='2026-01-01T00:00:00Z',ms_played=45678,skipped=True,offline=True,spotify_track_uri='spotify:track:abc')
        result=export_play(row)
        self.assertEqual(result['ms_played'],45678)
        self.assertTrue(result['skipped'])
        self.assertEqual(result['source'],'export')
        row['ms_played']=29999
        self.assertIsNone(export_play(row))

    def test_malformed_export_is_skipped(self):
        self.assertIsNone(export_play(None))
        self.assertIsNone(export_play({}))

    def test_offline_batch_at_one_second_survives(self):
        # Spotify flushes offline plays with a shared timestamp. Those are
        # different tracks, not a rounding artefact, so none may be collapsed.
        batch=[play('2026-01-01T00:00:00Z',f'track-{i}') for i in range(40)]
        self.assertEqual(len(deduplicate_batch(batch)),40)
