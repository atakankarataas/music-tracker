"""Configure and verify the two-minute Supabase tracker without printing secrets.

Run migrate.py first. Configure Vault, deploy spotify-sync in Supabase, then
activate. Existing GitHub scheduling should only be removed after cron succeeds.
"""
import argparse
import json
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import psycopg2
import requests
from ingest.migrate import load_local_env

NAMES = ('music_tracker_endpoint', 'music_tracker_trigger_secret')


def configure(conn):
    cache_path = Path(os.environ.get('SPOTIPY_CACHE_PATH', str(ROOT / '.cache')))
    raw_cache = os.environ.get('SPOTIPY_CACHE')
    cache = json.loads(raw_cache) if raw_cache else json.loads(cache_path.read_text()) if cache_path.exists() else {}
    token = os.environ.get('SPOTIFY_REFRESH_TOKEN') or cache.get('refresh_token')
    if not token:
        raise RuntimeError('Spotify refresh token is required')
    user = urlparse(os.environ['DB_URI']).username or ''
    reference = os.environ.get('SUPABASE_PROJECT_REF') or user.split('.')[-1]
    if len(reference) != 20 or not reference.isalpha():
        raise RuntimeError('SUPABASE_PROJECT_REF is required for a direct DB connection')
    values = {
        'music_tracker_endpoint': f'https://{reference}.supabase.co/functions/v1/spotify-sync',
        'music_spotify_client_id': os.environ['SPOTIPY_CLIENT_ID'],
        'music_spotify_client_secret': os.environ['SPOTIPY_CLIENT_SECRET'],
        'music_spotify_refresh_token': token,
    }
    with conn.cursor() as cur:
        cur.execute('SELECT id,name FROM vault.secrets WHERE name=ANY(%s)', (list(values) + ['music_tracker_trigger_secret'],))
        existing = dict((name, sid) for sid, name in cur.fetchall())
        for name, value in values.items():
            if name in existing:
                # Preserve a refresh token rotated by the deployed function.
                if name != 'music_spotify_refresh_token':
                    cur.execute('SELECT vault.update_secret(%s,%s)', (existing[name], value))
            else:
                cur.execute('SELECT vault.create_secret(%s,%s)', (value, name))
        if 'music_tracker_trigger_secret' not in existing:
            cur.execute('SELECT vault.create_secret(%s,%s)', (secrets.token_urlsafe(48), 'music_tracker_trigger_secret'))
    conn.commit()
    print('Supabase Vault configured: endpoint, trigger credential and Spotify credentials.')


def invocation_credentials(conn):
    with conn.cursor() as cur:
        cur.execute('SELECT name,decrypted_secret FROM vault.decrypted_secrets WHERE name=ANY(%s)', (list(NAMES),))
        values = dict(cur.fetchall())
    conn.commit()
    if not all(name in values for name in NAMES):
        raise RuntimeError('Run --configure first')
    return values[NAMES[0]], values[NAMES[1]]


def verify(conn):
    endpoint, token = invocation_credentials(conn)
    for headers in ({}, {'Authorization': 'Bearer invalid-test-token'}):
        response = requests.post(endpoint, json={}, headers=headers, timeout=30)
        if response.status_code != 401:
            raise RuntimeError(f'Unauthorized invocation unexpectedly returned {response.status_code}')
    headers = {'Authorization': 'Bearer ' + token, 'x-region': 'ap-northeast-1'}
    dry = requests.post(endpoint, json={'dry_run': True}, headers=headers, timeout=130)
    if dry.status_code != 200 or dry.json().get('status') != 'dry_run':
        raise RuntimeError(f'Dry run failed: HTTP {dry.status_code}; check protected function logs')
    print('Authenticated dry run:', json.dumps(dry.json()))
    for attempt in range(2):
        response = requests.post(endpoint, json={}, headers=headers, timeout=130)
        if response.status_code != 200 or response.json().get('status') not in ('success', 'warning'):
            raise RuntimeError(f'Live invocation failed: HTTP {response.status_code}')
        result = response.json()
        print(f'Live invocation {attempt+1}:', json.dumps(result))
        if attempt == 1 and result['inserted'] != 0:
            print('New plays arrived between invocations; SQL replay regression test covers identity matching.')


def activate(conn):
    verify(conn)
    with conn.cursor() as cur:
        for name, schedule, command in (
            ('spotify-sync', '*/2 * * * *', 'SELECT public.music_trigger_spotify_sync(false)'),
            ('spotify-sync-recovery', '15 3 * * *', 'SELECT public.music_trigger_spotify_sync(true)'),
            ('spotify-sync-log-retention', '29 3 * * *', 'SELECT public.music_cleanup_edge_logs()'),
        ):
            cur.execute('SELECT cron.schedule(%s,%s,%s)', (name, schedule, command))
        cur.execute("SELECT jobname,schedule,active FROM cron.job WHERE jobname LIKE 'spotify-sync%' ORDER BY jobname")
        print('Activated schedules:', cur.fetchall())
    conn.commit()


def main():
    load_local_env()
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--configure', action='store_true')
    mode.add_argument('--verify', action='store_true')
    mode.add_argument('--activate', action='store_true')
    args = parser.parse_args()
    with psycopg2.connect(os.environ['DB_URI'], connect_timeout=15) as conn:
        if args.configure:
            configure(conn)
        elif args.verify:
            verify(conn)
        else:
            activate(conn)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Database exceptions can contain credential-bearing connection details.
        print(f'Supabase tracker setup failed ({type(exc).__name__}). Check the configuration.', file=sys.stderr)
        raise SystemExit(1) from None
