"""Shared Spotify authorization settings.

Keeping one scope set prevents a helper script from replacing the cached token
with a narrower token that silently breaks now-playing.
"""

SPOTIFY_SCOPES = " ".join(
    (
        "user-read-recently-played",
        "user-read-currently-playing",
        "user-read-playback-state",
    )
)
