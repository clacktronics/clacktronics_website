# Clack Video Lab

A standalone, browser-only video player/editor for ClackOS. It runs both as its
own page and inside a ClackOS iframe window.

## What works

- Native playback plus an embedded FFmpeg WebAssembly compatibility path for
  formats the browser cannot preview directly.
- Forward/reverse playback, 0.25×–4× speed, whole-project loop, and A/B loop.
- Bounce: play to the end, then back to the start. On its own that is one
  there-and-back; with loop on it keeps turning round.
- A clip timeline with insert-before, insert-after, cut-before-playhead, and
  cut-after-playhead.
- An extra audio layer starting at the playhead, either mixed over the original
  audio or replacing it, with 0–200% rendered gain.
- Browser-only export to MP4, WebM, MOV, MKV, AVI, GIF, MP3, WAV, Ogg, or a
  custom container extension.
- **File → Export → Raw**: the pair of raw files Popcorn wants (see below).
- **File → Export → Images**: one still per frame, zipped, at a frame rate and
  width you choose.
- Drag-and-drop and keyboard transport controls (`J`, `K`, `L`, `B`, `I`, `O`,
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

It can also open a site-hosted or CORS-enabled video directly from Markdown:

```markdown
[Open in Video Lab](app:applications/video/index.html?src=content%2Fmedia%2Fdemo.mp4)
```

The Markdown Editor's Insert menu generates this link and URL-encodes the
source automatically.

## Raw export for Popcorn on the RP2040

[Popcorn](https://github.com/raspberrypi/pico-playground/tree/master/apps/popcorn)
is the movie player in `pico-playground`: 320 × 240 at 30fps with 44.1 kHz
stereo, off an SD card, on a Pico VGA demo board. Its converter takes two raw
files and crashes on anything else, so **File → Export → Raw** writes exactly
those and nothing else:

| File   | Contents                                                |
| ------ | ------------------------------------------------------- |
| `.rgb` | 320 × 240, 30fps, 24-bit raw RGB — 6.9 MB per second     |
| `.pcm` | 44 100 Hz stereo signed 16-bit little-endian — 176 kB/s  |

Then, on a machine with the converter built:

```sh
converter clack-video.rgb clack-video.pcm movie.pl2
```

Framing picks between filling the 4:3 frame and cropping the overhang, or
fitting the whole picture and letterboxing the gap. Neither file is compressed,
so the panel estimates the size before the render starts and refuses anything
over about 700 MB — past that the tab runs out of memory partway through and
the work is wasted. In practice that is roughly a minute and a half of video.

## Image sequence export

**File → Export → Images** renders one still per frame and collects them into a
ZIP, at 1–30fps and up to a chosen width. It is less demanding than the raw
export, because each frame is read out of the FFmpeg filesystem and deleted
again before the next one is written, and because PNG and JPEG are compressed —
but the frame count still governs everything, so the ceiling is 1200 frames.
That is two minutes at 10fps, or 40 seconds at 30. The estimate in the panel
counts the frames before you commit to them.

## Practical browser limits

“Any format” means any unencrypted format and codec included in the pinned
FFmpeg WebAssembly build. DRM-protected streams and proprietary codecs omitted
from that build cannot be opened. WebAssembly works in memory, so very long,
very high-resolution, or multi-gigabyte projects can exhaust a browser tab.
Reverse rendering is especially memory-intensive because FFmpeg must buffer the
stream, and a baked bounce buffers it twice. Short and medium projects are the
intended sweet spot.

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
zip.js                    Store-only ZIP writer for the image sequence
vendor/ffmpeg/            @ffmpeg/ffmpeg 0.12.15 ESM client
jsDelivr (runtime)        @ffmpeg/core 0.12.10 single-thread core
vendor/PROVENANCE.md      Dependency source and license notes
```
