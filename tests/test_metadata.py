import unittest
from unittest.mock import Mock
import spotipy
from metadata_backfill import CatalogReader


class CatalogTests(unittest.TestCase):
    def test_supported_batch_preserves_unavailable_positions(self):
        client = Mock()
        client.tracks.return_value = {'tracks': [{'id': 'a'}, None, {'id': 'c'}]}
        self.assertEqual(CatalogReader(client).get('tracks', ['a', 'b', 'c']),
                         [{'id': 'a'}, None, {'id': 'c'}])
        client.track.assert_not_called()

    def test_disabled_batch_falls_back_once(self):
        client = Mock()
        client.tracks.side_effect = spotipy.SpotifyException(403, -1, 'unavailable')
        client.track.side_effect = lambda key: {'id': key}
        reader = CatalogReader(client)
        self.assertEqual(reader.get('tracks', ['a', 'b']), [{'id': 'a'}, {'id': 'b'}])
        reader.get('tracks', ['c'])
        self.assertEqual(client.tracks.call_count, 1)

    def test_rate_limit_does_not_multiply_requests(self):
        client = Mock()
        client.artists.side_effect = spotipy.SpotifyException(429, -1, 'rate limit')
        with self.assertRaises(spotipy.SpotifyException):
            CatalogReader(client).get('artists', ['a', 'b'])
        client.artist.assert_not_called()
