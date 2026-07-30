#!/usr/bin/env python3
"""Build the read-only legacy website media catalogue used by File Manager.

The legacy assets/old_assets/ directory intentionally has no public directory
listing, so the catalogue is derived from media URLs referenced by the site's
content. Run this after adding or changing legacy asset links in Markdown/HTML
files.

Content links to that media relatively (assets/old_assets/NAME), which is what
the pattern below looks for. The absolute https://clacktronics.co.uk/assets/
form the media used to carry is still matched so a link written before the move
— or pasted from an old post — is still catalogued rather than silently
dropped; either way the entry is stored in the relative form.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content"
OUTPUT = CONTENT / "media-index.json"
MEDIA_BASE = "assets/old_assets/"
MEDIA_URL = re.compile(
    r"(?:https?://(?:www\.)?clacktronics\.co\.uk/assets/+(?!uploads/)"
    r"|(?<![\w./-])assets/old_assets/)"
    r"[^\s\)\]\}\"'<>]+",
    re.IGNORECASE,
)
MEDIA_EXTENSIONS = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
    ".webp": "image", ".bmp": "image", ".svg": "image", ".avif": "image",
    ".mp4": "video", ".webm": "video", ".mov": "video", ".m4v": "video",
    ".ogv": "video", ".avi": "video", ".mkv": "video",
    ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".m4a": "audio",
    ".flac": "audio", ".aac": "audio",
    ".stl": "model", ".step": "model", ".stp": "model", ".obj": "model",
    ".3mf": "model", ".glb": "model",
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
            # Store one form regardless of how the link was written: strip the
            # old absolute prefix or the relative base off the front and put the
            # relative base back on, so the two spellings of the same file
            # collapse to a single entry.
            tail = parsed.path.lstrip("/")
            for prefix in (MEDIA_BASE, "assets/"):
                if tail.lower().startswith(prefix):
                    tail = tail[len(prefix):]
                    break
            canonical = MEDIA_BASE + tail
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
        "baseUrl": MEDIA_BASE,
        "note": "Generated from public media references because the legacy assets directory is not listable.",
        "files": files,
    }
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(files)} media entries to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
