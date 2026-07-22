#!/usr/bin/env python3
"""Build the read-only legacy website media catalogue used by File Manager.

The live /assets/ directory intentionally has no public directory listing, so
the catalogue is derived from media URLs referenced by the site's content.
Run this after adding or changing legacy asset links in Markdown/HTML files.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content"
OUTPUT = CONTENT / "media-index.json"
MEDIA_URL = re.compile(
    r"https?://(?:www\.)?clacktronics\.co\.uk/assets/[^\s\)\]\}\"'<>]+",
    re.IGNORECASE,
)
MEDIA_EXTENSIONS = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
    ".webp": "image", ".bmp": "image", ".svg": "image", ".avif": "image",
    ".mp4": "video", ".webm": "video", ".mov": "video", ".m4v": "video",
    ".ogv": "video", ".avi": "video", ".mkv": "video",
    ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".m4a": "audio",
    ".flac": "audio", ".aac": "audio",
}


def clean_url(value: str) -> str:
    return value.rstrip(".,;:!?")


def main() -> None:
    found: dict[str, dict[str, str]] = {}
    for source in sorted(CONTENT.rglob("*")):
        if not source.is_file() or source.suffix.lower() not in {".md", ".html", ".json"}:
            continue
        if source == OUTPUT:
            continue
        text = source.read_text(encoding="utf-8", errors="ignore")
        for match in MEDIA_URL.findall(text):
            url = clean_url(match)
            parsed = urlsplit(url)
            name = unquote(Path(parsed.path).name)
            kind = MEDIA_EXTENSIONS.get(Path(parsed.path).suffix.lower())
            if not name or not kind:
                continue
            canonical = f"https://clacktronics.co.uk{parsed.path}"
            if parsed.query:
                canonical += f"?{parsed.query}"
            found[canonical.lower()] = {
                "name": name,
                "url": canonical,
                "kind": kind,
                "source": source.relative_to(ROOT).as_posix(),
            }

    files = sorted(found.values(), key=lambda item: (item["kind"], item["name"].lower(), item["url"]))
    payload = {
        "baseUrl": "https://clacktronics.co.uk/assets/",
        "note": "Generated from public media references because the live assets directory is not listable.",
        "files": files,
    }
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(files)} media entries to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
