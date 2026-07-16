# Clack Video Lab

A standalone, browser-only video player/editor for ClackOS. It runs both as its
own page and inside a ClackOS iframe window.

## What works

- Native playback plus an embedded FFmpeg WebAssembly compatibility path for
  formats the browser cannot preview directly.
- Forward/reverse playback, 0.25×–4× speed, whole-project loop, and A/B loop.
- A clip timeline with insert-before, insert-after, cut-before-playhead, and
  cut-after-playhead.
- An extra audio layer starting at the playhead, either mixed over the original
  audio or replacing it, with 0–200% rendered gain.
- Browser-only export to MP4, WebM, MOV, MKV, AVI, GIF, MP3, WAV, Ogg, or a
  custom container extension.
- Drag-and-drop and keyboard transport controls (`J`, `K`, `L`, `I`, `O`,
  comma/period, and Space).

Files are handled with object URLs and an in-memory FFmpeg filesystem. Nothing
is uploaded to a server.

## Run it

This is a static app with no package manager or build step:

```sh
python -m http.server 8000
```

From the repository root, open
`http://localhost:8000/content/applications/video/`. If serving this folder
directly, open `http://localhost:8000/`.

Opening `index.html` via `file://` will not work because browsers do not permit
the module worker and WebAssembly fetches in that mode.

## ClackOS integration

`content/applications/menu.json` registers `video/index.html` as the Video Lab
application. The page is iframe-safe and follows the same standalone-app
pattern as Paint, Sound Recorder, Markdown, and Python. Its CSS is
self-contained, so no shared ClackOS stylesheet needs to change.

## Practical browser limits

“Any format” means any unencrypted format and codec included in the pinned
FFmpeg WebAssembly build. DRM-protected streams and proprietary codecs omitted
from that build cannot be opened. WebAssembly works in memory, so very long,
very high-resolution, or multi-gigabyte projects can exhaust a browser tab.
Reverse rendering is especially memory-intensive because FFmpeg must buffer the
stream. Short and medium projects are the intended sweet spot.

The single-thread FFmpeg core is fetched from jsDelivr at its pinned version,
so the app does not require cross-origin isolation headers or add a large binary
to the site repository. It is approximately 31 MB and loads only when a
compatibility preview or export is needed; that first advanced operation needs
an internet connection.

The vendored JavaScript client is MIT-licensed, while the published FFmpeg core
enables GPL codecs. Keep the notices under `vendor/` when redistributing the
app.

## Project layout

```text
index.html                App markup and controls
styles.css                ClackOS-derived standalone theme
main.js                   Player, timeline, audio, markers, and UI behavior
ffmpeg-engine.js          Compatibility conversion and export graph
vendor/ffmpeg/            @ffmpeg/ffmpeg 0.12.15 ESM client
jsDelivr (runtime)        @ffmpeg/core 0.12.10 single-thread core
vendor/PROVENANCE.md      Dependency source and license notes
```
