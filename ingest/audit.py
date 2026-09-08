"""Read-only reconciliation of DB plays with local Spotify exports and live history."""
import bisect
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))
import psycopg2
import requests
import spotipy
from ingest.migrate import load_local_env
from ingest.import_history import export_play
from ingest.storage import parse_time
from tracker import fetch_recent_history


def main():
    load_local_env()
    conn=psycopg2.connect(os.environ['WEB_DB_URI'],connect_timeout=15,
        options='-c default_transaction_read_only=on -c statement_timeout=30000')
    with conn.cursor() as cur:
        cur.execute('SELECT spotify_id,track_name,artist_name,played_at FROM public.scrobbles ORDER BY played_at')
        rows=cur.fetchall()
    conn.close()
    times=defaultdict(list)
    db_seconds=set()
    for track,name,artist,at in rows:
        key=track or (name,artist)
        times[key].append(at.timestamp())
        db_seconds.add(round(at.timestamp(),3))
    def exists(track,name,artist,at):
        values=times.get(track or (name,artist),[])
        at=parse_time(at).timestamp()
        index=bisect.bisect_left(values,at-3)
        return index<len(values) and values[index]<=at+3
    summary={'checked_at':datetime.now(timezone.utc).isoformat(),'database_plays':len(rows),'last_play':rows[-1][3].isoformat() if rows else None}
    total=matched=0
    missing=Counter()
    unmatched_at=[]
    first=last=None
    unique=set()
    for path in sorted((ROOT/'Spotify Extended Streaming History').glob('*.json')):
        data=json.loads(path.read_text())
        if not isinstance(data,list): continue
        for item in data:
            play=export_play(item)
            if not play: continue
            key=(play['spotify_id'],play['played_at'])
            if key in unique: continue
            unique.add(key)
            at=parse_time(play['played_at'])
            first=min(first,at) if first else at
            last=max(last,at) if last else at
            total+=1
            if exists(play['spotify_id'],play['track_name'],play['artist_name'],at):matched+=1
            else:
                missing[at.strftime('%Y-%m')]+=1
                unmatched_at.append(at)
    # A different track at the same timestamp is now valid (migration 0013).
    # Keep collision counts diagnostic; every unmatched eligible play is missing.
    collisions=sum(1 for at in unmatched_at if round(at.timestamp(),3) in db_seconds)
    summary['export']={'eligible_unique':total,'matched':matched,'missing':total-matched,
        'unmatched_with_shared_timestamp':collisions,
        'first':str(first),'last':str(last),'missing_by_month':dict(missing)}
    try:
        cache=json.loads((ROOT/'.cache').read_text())
        token=cache.get('access_token')
        if cache.get('expires_at',0)<=datetime.now(timezone.utc).timestamp()+30:
            response=requests.post('https://accounts.spotify.com/api/token',
                auth=(os.environ['SPOTIPY_CLIENT_ID'],os.environ['SPOTIPY_CLIENT_SECRET']),
                data={'grant_type':'refresh_token','refresh_token':os.environ.get('SPOTIFY_REFRESH_TOKEN') or cache['refresh_token']},timeout=15)
            response.raise_for_status();token=response.json()['access_token']
        sp=spotipy.Spotify(auth=token,requests_timeout=10,retries=1,status_retries=1)
        items,pages,reason=fetch_recent_history(sp,datetime.now(timezone.utc)-timedelta(days=7),force_recovery=True)
        matches=sum(exists(i['track'].get('id'),i['track']['name'],i['track']['artists'][0]['name'],i['played_at']) for i in items)
        summary['live_spotify']={'fetched':len(items),'matched':matches,'missing':len(items)-matches,'pages':pages,'stop_reason':reason}
    except Exception as exc:
        summary['live_spotify']={'error':type(exc).__name__}
    report=ROOT/'TRACKER_AUDIT.json'
    report.write_text(json.dumps(summary,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps(summary,indent=2,ensure_ascii=False))

if __name__=='__main__': main()
