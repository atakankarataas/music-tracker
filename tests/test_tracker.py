import unittest
from datetime import datetime, timedelta, timezone

from tracker import env_bool, env_int, fetch_recent_history, timestamp_millis


def play(minutes):
    played_at = BASE_TIME + timedelta(minutes=minutes)
    return {"played_at": played_at.isoformat().replace("+00:00", "Z"), "track": {}}


BASE_TIME = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)


class FakeSpotify:
    def __init__(self, pages):
        self.pages = list(pages)
        self.calls = []

    def current_user_recently_played(self, **request):
        self.calls.append(request)
        if not self.pages:
            return {"items": []}
        return {"items": self.pages.pop(0)}


class CursorSpotify(FakeSpotify):
    def current_user_recently_played(self, **request):
        response = super().current_user_recently_played(**request)
        if response["items"]:
            response["cursors"] = {"before": "123456789"}
        return response


class TrackerPaginationTests(unittest.TestCase):
    def test_distinct_tracks_with_the_same_timestamp_survive(self):
        first = play(0)
        first["track"] = {"id": "first"}
        second = play(0)
        second["track"] = {"id": "second"}
        items, _, _ = fetch_recent_history(
            FakeSpotify([[first, second, first]]), cutoff=BASE_TIME - timedelta(days=1)
        )
        self.assertEqual({item["track"]["id"] for item in items}, {"first", "second"})

    def test_pages_back_until_database_overlap(self):
        spotify = FakeSpotify([
            [play(30), play(20)],
            [play(10), play(0)],
        ])

        items, page_count, reason = fetch_recent_history(
            spotify,
            cutoff=BASE_TIME - timedelta(days=7),
            last_played_at=BASE_TIME,
            max_pages=20,
            overlap_pages=1,
        )

        self.assertEqual(page_count, 2)
        self.assertEqual(reason, "database overlap reached")
        self.assertEqual(len(items), 4)
        self.assertNotIn("before", spotify.calls[0])
        self.assertEqual(
            spotify.calls[1]["before"],
            timestamp_millis(BASE_TIME + timedelta(minutes=20)),
        )

    def test_recovery_ignores_overlap_and_reaches_cutoff(self):
        spotify = FakeSpotify([
            [play(30), play(20)],
            [play(10), play(0)],
            [play(-30), play(-60)],
            [play(-90), play(-120)],
        ])

        items, page_count, reason = fetch_recent_history(
            spotify,
            cutoff=BASE_TIME - timedelta(minutes=90),
            last_played_at=BASE_TIME,
            max_pages=20,
            overlap_pages=1,
            force_recovery=True,
        )

        self.assertEqual(page_count, 4)
        self.assertEqual(reason, "lookback boundary reached")
        self.assertEqual(len(items), 7)
        self.assertEqual(items[0]["played_at"], play(-90)["played_at"])
        self.assertEqual(items[-1]["played_at"], play(30)["played_at"])

    def test_duplicate_timestamps_are_collapsed(self):
        spotify = FakeSpotify([
            [play(10), play(5)],
            [play(5), play(0)],
        ])

        items, _, _ = fetch_recent_history(
            spotify,
            cutoff=BASE_TIME - timedelta(days=1),
            last_played_at=BASE_TIME,
            overlap_pages=1,
        )

        self.assertEqual(len(items), 3)

    def test_spotify_cursor_is_preferred_for_next_page(self):
        spotify = CursorSpotify([
            [play(30), play(20)],
            [play(10), play(0)],
        ])

        fetch_recent_history(
            spotify,
            cutoff=BASE_TIME - timedelta(days=1),
            last_played_at=BASE_TIME,
            overlap_pages=1,
        )

        self.assertEqual(spotify.calls[1]["before"], 123456789)


class TrackerEnvironmentTests(unittest.TestCase):
    def test_boolean_values(self):
        import os
        from unittest.mock import patch

        with patch.dict(os.environ, {"SYNC_TEST": "true"}):
            self.assertTrue(env_bool("SYNC_TEST"))
        with patch.dict(os.environ, {"SYNC_TEST": "0"}):
            self.assertFalse(env_bool("SYNC_TEST", True))

    def test_integer_bounds(self):
        import os
        from unittest.mock import patch

        with patch.dict(os.environ, {"SYNC_TEST": "20"}):
            self.assertEqual(env_int("SYNC_TEST", 2, 1, 20), 20)
        with patch.dict(os.environ, {"SYNC_TEST": "21"}):
            with self.assertRaises(RuntimeError):
                env_int("SYNC_TEST", 2, 1, 20)


if __name__ == "__main__":
    unittest.main()
