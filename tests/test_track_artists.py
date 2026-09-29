import unittest
import json
import time
from unittest.mock import patch, Mock
from ingest.track_artists import rows_for, access_token


def track(name, *artists):
    return {"name": name, "artists": [{"id": f"id-{a}", "name": a} for a in artists]}


class TrackArtistTests(unittest.TestCase):
    def test_co_primary_is_not_marked_featured(self):
        rows = rows_for("t1", track("Mumkunse", "BEGE", "Gunes"))
        self.assertEqual([r[3] for r in rows], ["BEGE", "Gunes"])
        self.assertEqual([r[4] for r in rows], [False, False])

    def test_guest_named_in_the_title_is_marked_featured(self):
        rows = rows_for("t2", track("STAY HERE 4 LIFE (feat. Brent Faiyaz)", "Lead", "Brent Faiyaz"))
        self.assertEqual([r[4] for r in rows], [False, True])

    def test_a_co_primary_on_a_feat_track_keeps_full_billing(self):
        # Only Bruno Mars is the guest here; Wiz Khalifa shares the billing.
        rows = rows_for("t6", track("Young, Wild & Free (feat. Bruno Mars)",
                                    "Snoop Dogg", "Wiz Khalifa", "Bruno Mars"))
        self.assertEqual([r[4] for r in rows], [False, False, True])

    def test_every_named_guest_is_flagged(self):
        rows = rows_for("t7", track("Too Many Nights (feat. Don Toliver & with Future)",
                                    "Metro Boomin", "Future", "Don Toliver"))
        self.assertEqual([r[4] for r in rows], [False, True, True])

    def test_stylised_spelling_still_matches(self):
        rows = rows_for("t8", track("Ain't Got No Haters (feat. Too Short)", "Ice Cube", "Too $hort"))
        self.assertEqual([r[4] for r in rows], [False, True])

    def test_primary_is_never_featured_even_on_a_feat_track(self):
        rows = rows_for("t3", track("Song (feat. Guest)", "Lead"))
        self.assertEqual(rows[0][4], False)

    def test_position_is_recorded_in_order(self):
        rows = rows_for("t4", track("Trio", "A", "B", "C"))
        self.assertEqual([r[1] for r in rows], [0, 1, 2])

    def test_missing_track_yields_nothing(self):
        self.assertEqual(rows_for("t5", None), [])

    def test_duplicate_catalogue_artist_gets_one_credit(self):
        self.assertEqual(len(rows_for("t", track("Duet", "A", "A", "B"))), 2)

    def test_ci_cache_does_not_require_a_local_file(self):
        cache = json.dumps({"access_token": "ci-token", "expires_at": time.time()+3600})
        with patch.dict('os.environ', {"SPOTIPY_CACHE": cache}, clear=True), patch('pathlib.Path.read_text', side_effect=AssertionError('local cache read')):
            self.assertEqual(access_token(), 'ci-token')

    def test_401_can_force_refresh_of_unexpired_token(self):
        cache = json.dumps({"access_token": "rejected", "expires_at": time.time()+3600, "refresh_token": "refresh"})
        response = Mock()
        response.json.return_value = {"access_token": "new-token"}
        with patch.dict('os.environ', {"SPOTIPY_CACHE": cache, "SPOTIPY_CLIENT_ID": "id", "SPOTIPY_CLIENT_SECRET": "secret"}, clear=True), patch('ingest.track_artists.requests.post', return_value=response) as post:
            self.assertEqual(access_token(force_refresh=True), 'new-token')
            self.assertEqual(post.call_args.kwargs['data']['refresh_token'], 'refresh')
