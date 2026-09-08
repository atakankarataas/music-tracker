import spotipy
from spotipy.oauth2 import SpotifyOAuth

from ingest.spotify_auth import SPOTIFY_SCOPES
import os

CLIENT_ID = os.environ["SPOTIPY_CLIENT_ID"]
CLIENT_SECRET = os.environ["SPOTIPY_CLIENT_SECRET"]
REDIRECT_URI = os.environ.get("SPOTIPY_REDIRECT_URI", "http://127.0.0.1:8888/callback")
CACHE_PATH = os.environ.get("SPOTIPY_CACHE_PATH", ".cache")

def main():
    # Bu işlem tarayıcıyı açacak ve izin isteyecek
    sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        redirect_uri=REDIRECT_URI,
        scope=SPOTIFY_SCOPES,
        open_browser=True,
        cache_path=CACHE_PATH # Token buraya kaydedilecek
    ))

    print("--- İŞLEM BAŞARILI! ---")
    print("Klasöründe '.cache' adında bir dosya oluştu.")
    print("O dosyanın içindeki tüm yazıyı kopyalayıp sakla.")
    
    # Test edelim
    results = sp.current_user_recently_played(limit=1)
    print(f"Son dinlenen test: {results['items'][0]['track']['name']}")

if __name__ == "__main__":
    main()
