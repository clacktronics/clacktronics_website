#!/usr/bin/env python3
"""Build the index of QBasic programs preloaded into the emulator.

The site is served as static files with no directory listing, so the QBasic
application cannot discover the programs on its own. This writes a small index
next to them listing what to copy into the emulated C:\\PROGRAMS directory at
startup. Run it after adding, renaming or removing a .BAS file.

The title of each program is its first comment line, so the index needs no
separate description to maintain.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROGRAMS = ROOT / "content" / "applications" / "qbasic" / "programs"
OUTPUT = PROGRAMS / "programs.json"
# DOS 8.3: up to eight characters, then the .BAS extension
DOS_NAME = re.compile(r"^[A-Z0-9_]{1,8}\.BAS$")


def title_of(source: Path) -> str:
    """Return the program's first comment line, without its leading marker."""
    for line in source.read_text(encoding="latin-1").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("'"):
            return stripped.lstrip("'").strip().rstrip(".")
        if stripped.upper().startswith("REM "):
            return stripped[4:].strip().rstrip(".")
        break
    return source.stem.title()


def main() -> None:
    programs = []
    for source in sorted(PROGRAMS.glob("*.BAS")):
        if not DOS_NAME.match(source.name):
            raise SystemExit(
                f"{source.name} is not a DOS 8.3 name: use up to eight "
                "uppercase characters plus the .BAS extension"
            )
        programs.append({
            "file": source.name,
            "title": title_of(source),
            "size": source.stat().st_size,
        })

    OUTPUT.write_text(
        json.dumps({"version": 1, "programs": programs}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT.relative_to(ROOT)} with {len(programs)} programs")


if __name__ == "__main__":
    main()
