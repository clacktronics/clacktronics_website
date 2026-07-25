#!/usr/bin/env python3
"""Mirror the events from a Luma profile into content/applications/calendar/luma.json.

The Calendar app shows these alongside the hand-kept events.csv, but they are
never written into that file: this JSON is the whole record of what came from
Luma, and it is regenerated rather than edited.

Luma sends no Access-Control-Allow-Origin header, so the browser cannot fetch
the profile itself — the fetch has to happen here, on a schedule, and the
result is committed (see .github/workflows/luma-events.yml).

Configuration lives in content/site.json:

    "luma": {
      "username": "clacktronics",
      "userApiId": "usr-...",        optional; resolved from the profile if absent
      "pastMonths": 24
    }

Only events Luma reports as public are mirrored. Times are written as local
wall-clock in the event's own timezone, the way Luma displays them and the way
events.csv records them, so both sources read the same in the app.

Usage:
    python3 scripts/fetch_luma_events.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parent.parent
SITE_JSON = ROOT / 'content' / 'site.json'
OUT_PATH = ROOT / 'content' / 'applications' / 'calendar' / 'luma.json'

API = 'https://api.lu.ma/user/profile/events-hosting'
PROFILE = 'https://luma.com/user/{username}'
EVENT_URL = 'https://luma.com/{slug}'
PAGE_SIZE = 50
# a courtesy to Luma, and it keeps a broken loop from hammering them
MAX_PAGES = 20
USER_AGENT = ('clacktronics-website-calendar/1.0 '
              '(+https://clacktronics.co.uk/; mirrors its own Luma events)')


def get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={
        'accept': 'application/json',
        'user-agent': USER_AGENT,
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def resolve_user_api_id(username: str) -> str:
    """Luma's profile page carries the account's api_id in its __NEXT_DATA__."""
    page = urllib.request.Request(PROFILE.format(username=username),
                                  headers={'user-agent': USER_AGENT})
    with urllib.request.urlopen(page, timeout=45) as response:
        html = response.read().decode('utf-8', 'replace')
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
                      html, re.S)
    if not match:
        raise SystemExit(f'Could not find the profile data for @{username} — '
                         'set "userApiId" in the luma block of content/site.json.')
    data = json.loads(match.group(1))
    api_id = (data.get('props', {}).get('pageProps', {}).get('initialData', {})
              .get('user', {}).get('api_id'))
    if not api_id:
        raise SystemExit(f'The profile for @{username} carried no api_id — '
                         'set "userApiId" in the luma block of content/site.json.')
    return api_id


def fetch_period(user_api_id: str, period: str) -> list[dict]:
    """Every page of one period ("future" or "past")."""
    entries: list[dict] = []
    cursor = None
    for _ in range(MAX_PAGES):
        args = {'user_api_id': user_api_id, 'period': period, 'pagination_limit': PAGE_SIZE}
        if cursor:
            args['pagination_cursor'] = cursor
        payload = json.loads(get(f'{API}?{urllib.parse.urlencode(args)}'))
        entries.extend(payload.get('entries') or [])
        cursor = payload.get('next_cursor')
        if not payload.get('has_more') or not cursor:
            return entries
    print(f'  ! stopped after {MAX_PAGES} pages of {period} events', file=sys.stderr)
    return entries


def local_stamp(value: str | None, tz: ZoneInfo) -> str:
    """Luma's UTC instants as wall-clock time where the event happens."""
    if not value:
        return ''
    moment = datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(tz)
    return moment.strftime('%Y-%m-%d %H:%M')


def zone_for(event: dict) -> ZoneInfo:
    try:
        return ZoneInfo(event.get('timezone') or 'UTC')
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo('UTC')


def place_of(event: dict) -> str:
    """A short human label: the venue, plus the town when it adds something."""
    if event.get('location_type') == 'online':
        return 'Online'
    address = event.get('geo_address_info') or {}
    parts = [address.get('address'), address.get('city')]
    seen: list[str] = []
    for part in parts:
        part = (part or '').strip()
        if part and part not in seen:
            seen.append(part)
    return ', '.join(seen)


def map_link(event: dict) -> str:
    coordinate = event.get('coordinate') or {}
    latitude, longitude = coordinate.get('latitude'), coordinate.get('longitude')
    if latitude is not None and longitude is not None:
        query = f'{latitude},{longitude}'
    else:
        address = event.get('geo_address_info') or {}
        query = (address.get('full_address') or address.get('address') or '').strip()
        if not query:
            return ''
    return 'https://www.google.com/maps/search/?api=1&query=' + urllib.parse.quote(query)


def notes_for(event: dict, url: str) -> str:
    """Markdown, the same as a hand-written note in events.csv."""
    lines = []
    address = event.get('geo_address_info') or {}
    description = (address.get('description') or '').strip()
    if description:
        lines.append(description)
    if url:
        lines.append(f'[Details and RSVP on Luma]({url})')
    return '\n\n'.join(lines)


def convert(entry: dict) -> dict | None:
    event = entry.get('event') or {}
    name = (event.get('name') or '').strip()
    if not name or not event.get('start_at'):
        return None
    if event.get('visibility') != 'public':
        return None

    tz = zone_for(event)
    start = local_stamp(event.get('start_at'), tz)
    end = local_stamp(event.get('end_at'), tz)
    slug = (event.get('url') or '').strip()
    url = EVENT_URL.format(slug=slug) if slug else ''

    record = {
        'id': event.get('api_id') or '',
        'title': name,
        'date': start,
        'location': place_of(event),
        'map': map_link(event),
        'url': url,
        'notes': notes_for(event, url),
        'timezone': str(tz),
    }
    # An end that matches the start tells the app nothing it cannot work out.
    if end and end != start:
        record['end'] = end
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true',
                        help='print what would be written without touching the file')
    options = parser.parse_args()

    site = json.loads(SITE_JSON.read_text(encoding='utf-8'))
    config = site.get('luma') or {}
    username = (config.get('username') or '').strip()
    if not username:
        print('No "luma" block with a username in content/site.json — nothing to mirror.')
        return 0

    user_api_id = (config.get('userApiId') or '').strip() or resolve_user_api_id(username)
    print(f'Mirroring @{username} ({user_api_id})')

    entries = fetch_period(user_api_id, 'future') + fetch_period(user_api_id, 'past')
    events = [record for record in (convert(entry) for entry in entries) if record]
    skipped = len(entries) - len(events)

    # Past events are kept so the app's "Show past events" toggle has something
    # to show, but not forever.
    months = int(config.get('pastMonths') or 24)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=months * 31)).strftime('%Y-%m-%d')
    events = [event for event in events if (event.get('end') or event['date'])[:10] >= cutoff]

    # One event per api_id, oldest first, so the file is stable between runs.
    unique = {event['id'] or f"{event['date']} {event['title']}": event for event in events}
    events = sorted(unique.values(), key=lambda event: (event['date'], event['title']))

    print(f'{len(events)} public event(s)'
          + (f', {skipped} skipped as non-public or incomplete' if skipped else ''))

    payload = {
        'source': PROFILE.format(username=username),
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'events': events,
    }

    if OUT_PATH.exists():
        try:
            existing = json.loads(OUT_PATH.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            existing = {}
        # The timestamp alone must never make a commit: keep the old one when
        # the events themselves have not moved.
        if existing.get('events') == events and existing.get('source') == payload['source']:
            print(f'{OUT_PATH.relative_to(ROOT)} is already up to date')
            return 0

    if options.dry_run:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n',
                        encoding='utf-8')
    print(f'wrote {OUT_PATH.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except urllib.error.URLError as error:
        raise SystemExit(f'Could not reach Luma: {error}')
