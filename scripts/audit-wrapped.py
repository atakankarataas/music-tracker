"""Compare local Wrapped screenshots with export + catalogue credits.

Usage: python3 scripts/audit-wrapped.py --references reports/wrapped-reference.json
  --credits /tmp/music-credits.json --output reports/wrapped-audit.json
References: {"2025": {"minutes": 22863, "artists": ["...", null]}}.
Unknown/hidden names must be null. No reference data is shipped in this script.
A rank match on calibration data is not proof of Spotify's hidden algorithm.
"""
import argparse
import collections
import datetime as dt
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--references', type=Path, required=True)
    parser.add_argument('--credits', type=Path, required=True)
    parser.add_argument('--history', type=Path, default=Path('Spotify Extended Streaming History'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    references = json.loads(args.references.read_text())
    credits = collections.defaultdict(list)
    for artist in json.loads(args.credits.read_text()):
        credits[artist['spotify_id']].append(artist)
    days = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0, 0]))
    minutes = collections.Counter()
    counts = collections.Counter()
    private = collections.Counter()
    covered = collections.Counter()
    tracks = collections.defaultdict(collections.Counter)
    for path in sorted(args.history.glob('*.json')):
        for item in json.loads(path.read_text()):
            day = (dt.datetime.fromisoformat(item['ts'].replace('Z', '+00:00'))
                   .astimezone(dt.timezone(dt.timedelta(hours=3)))).date().isoformat()
            if day[:4] not in references:
                continue
            # Minutes deliberately include short plays, private sessions and
            # non-music. The app's eligible-play table cannot reproduce this.
            minutes[day] += item.get('ms_played', 0) / 60000
            if not item.get('master_metadata_track_name') or item.get('ms_played', 0) <= 30000:
                continue
            if item.get('incognito_mode'):
                private[day] += 1
                continue
            counts[day] += 1
            tid = (item.get('spotify_track_uri') or '').split(':')[-1]
            artists = credits.get(tid)
            covered[day] += bool(artists)
            tracks[day][item['master_metadata_track_name']] += 1
            for artist in artists or [dict(artist_name=item['master_metadata_album_artist_name'], position=0, is_featured=False)]:
                component = 0 if artist['position'] == 0 else 2 if artist['is_featured'] else 1
                days[day][artist['artist_name']][component] += 1
    models = {'first_catalogue_artist': (0, 0), 'equal_credit': (1, 1),
              'previous_model': (1, .5), 'weighted_estimate': (.35, .35)}
    result = {'method': 'Raw export; >30s; known Private Sessions excluded from rankings; Istanbul day; all raw minutes.',
              'limitations': ['Catalogue order is not a verified billing role.',
                             'Taste Profile exclusions and content filters are unavailable.',
                             'Current catalogue may differ from historical credits.',
                             'Calibration match is not independent validation.'], 'years': {}}
    for year, reference in references.items():
        candidates = []
        for cutoff in [f'{year}-10-31'] + [f'{year}-11-{day:02}' for day in range(1, 26)]:
            totals = collections.defaultdict(lambda: [0, 0, 0])
            for day, artists in days.items():
                if f'{year}-01-01' <= day <= cutoff:
                    for artist, components in artists.items():
                        totals[artist] = [a+b for a, b in zip(totals[artist], components)]
            rankings = {}
            for model, (secondary, guest) in models.items():
                scores = {a: v[0] + secondary*v[1] + guest*v[2] for a, v in totals.items()}
                top = sorted(scores, key=lambda a: (-scores[a], a))[:5]
                rankings[model] = {'artists': top, 'scores': [round(scores[a], 2) for a in top],
                    'matching_positions': sum(a == b for a, b in zip(top, reference['artists']) if b is not None)}
            raw_minutes = sum(value for day, value in minutes.items() if f'{year}-01-01' <= day <= cutoff)
            candidates.append({'cutoff': cutoff, 'raw_minutes': round(raw_minutes),
                'minute_difference': round(raw_minutes-reference['minutes']), 'rankings': rankings})
        start, end = f'{year}-01-01', f'{year}-11-12'
        top_tracks = collections.Counter()
        for day, values in tracks.items():
            if start <= day <= end:
                top_tracks.update(values)
        result['years'][year] = {'reference': reference, 'default': candidates[12],
            'eligible_plays': sum(v for d,v in counts.items() if start<=d<=end),
            'private_plays_excluded': sum(v for d,v in private.items() if start<=d<=end),
            'credited_plays': sum(v for d,v in covered.items() if start<=d<=end),
            'top_tracks': top_tracks.most_common(5),
            'closest_minutes': min(candidates, key=lambda c: abs(c['minute_difference'])),
            'exact_rank_dates': [c['cutoff'] for c in candidates if c['rankings']['weighted_estimate']['matching_positions'] == 5],
            'candidates': candidates}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    for year, entry in result['years'].items():
        print(year, {k:v['matching_positions'] for k,v in entry['default']['rankings'].items()},
              'nearest minutes:', entry['closest_minutes']['cutoff'])


if __name__ == '__main__':
    main()
