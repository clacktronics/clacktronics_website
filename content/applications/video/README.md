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
- An effect stack applied to every frame — ClackPaint's filters, its dithers and
  its background matting, run here over video (see "Effects" below).
- Pre-rendering, for stacks too slow to preview as the clip plays.
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

## Effects

**Effects → Add filter** and **Add dither** build a stack that runs over every
frame, in order. The filters are ClackPaint's own, not copies of them: the maths
lives in `assets/js/clack-fx.js`, `../paint-dither.js` and `../paint-retouch.js`,
shared by both apps, so a filter added to ClackPaint's Effects menu shows up here
too. That is thirty filters — the blurs, Pixel Sorting, the distorts, Halftone,
Crystallize, JPEG Artifacts — and eight dither groups including Floyd–Steinberg
and the rest of the error-diffusion family.

Nothing is written back into the clip. Switching an effect off, or removing it,
restores the original picture exactly; the stack is applied again from scratch
on export.

The **Ink** and **Paper** colours below the stack feed the three filters that
need colours rather than reading them off the frame: the dithers quantise
towards them, and Clouds paints between them.

### Removing the background

**Effects → Remove background** offers the five matting methods from
`../paint-matte.js` that judge a frame on its own: chroma key, colour range,
flood from the edges, brightness and saliency. GrowCut and difference matting
are not offered — one needs scribbles on the picture and the other a second
layer, and neither has an answer for frame four hundred.

Judging each frame on its own is also the point. A cleverer matte that looked
at the whole clip would be steadier, and every per-frame method will crawl a
little at the edges where a pixel sits near the cutoff. **Chroma key is the one
to reach for**: it keys on hue alone, ignoring brightness, so a shadow on the
screen goes with the screen and the same pixel decides the same way every
frame. Widen **Edge softness** if the edge boils.

The background either goes transparent or is filled with a flat colour.
Transparency is the honest answer, but only WebM and a PNG sequence have
anywhere to put it — an MP4 will flatten it to black — so filling is offered
beside it. To key onto other footage, fill with a colour and composite
elsewhere, or export a PNG sequence.

The neural matting models ClackPaint offers are deliberately not here. MODNet
and the rest are hundreds of megabytes, want WebGPU to run at any speed, and
being per-frame would flicker worse than the classic methods rather than
better.

### What it costs

Frames do not depend on one another, so they are filtered in parallel by one
worker per core. Rough per-frame figures for a 720p frame on a modest machine:

| Filter | Per frame |
| --- | --- |
| Mosaic | 8 ms |
| Crystallize, Pixel Sorting | 70–85 ms |
| Error diffusion | 120 ms |
| Chroma key, colour range | 10–20 ms |
| Motion blur, Radial blur | 600–900 ms |

A ten-second clip is three hundred frames, so most stacks render in seconds and
the slowest in a couple of minutes.

The **preview** works at a reduced size, chosen from the filters in the stack
and how many there are, and asks for the next frame only once it has finished
the last — an expensive stack becomes a slower preview rather than a stuck one.
The export always renders at full size.

### Pre-rendering

Some stacks are simply too slow to keep up, and no amount of shrinking the
preview turns a second-a-frame filter into twenty-five frames a second.
**Pre-render** walks the range once, filters every frame at leisure and keeps
the results, after which playback is only drawing bitmaps and runs at full
speed. Scrubbing, looping and reverse all come from the cache.

It covers the A/B range when both markers are set and the whole project
otherwise, so pre-rendering the stretch you are working on is a matter of
setting A and B around it.

Frames are held as ImageBitmaps, and their total size is what governs
everything: a 1280 × 720 frame is 3.7 MB, so ten seconds of them at 25fps is
nearly a gigabyte. Rather than offer a resolution control nobody can price in
their head, the cache works out how large it can afford to be — 384 MB is the
budget — and the panel says how many frames, at what size, before anything is
rendered. Past about a minute and three quarters there is no size left worth
looking at, and it says so instead.

Capture uses a video element of its own, so the clip on screen stays scrubbable
while the render runs behind it. The button becomes **Cancel** while it works.

The cache is of one exact thing: this stack, these values, these colours, this
clip. Move any of them and the frames are of something else, so they are thrown
away and the live preview comes back. **Discard** frees them by hand.

Pre-rendering is a preview device and nothing more — it is held at preview
resolution and the export ignores it, rendering the stack again at full size.

### How a filtered export is put together

FFmpeg cannot run these filters, so a filtered video export is three passes
rather than one:

1. FFmpeg lays the project out as PNG stills at 30fps, applying speed, reverse,
   bounce and the audio layer as usual, and renders the audio to its own file.
2. Each still is decoded, run through the stack in the worker pool, and written
   back; the original is deleted straight away, so the WebAssembly filesystem
   holds one copy of the sequence rather than two.
3. FFmpeg encodes the filtered stills against that audio.

Stills rather than a raw stream because a raw 1080p frame is 8 MB and a
ten-second clip of them would not fit in the heap. PNG is lossless, so the round
trip costs time, not picture. It is governed by the same 1200-frame ceiling as
the image sequence — forty seconds at 30fps — and the export panel counts the
frames before you commit to them.

The image sequence export filters frames on the way into the ZIP, and only as
PNG, since a JPEG round trip would put the filters' output through a second
lossy pass. The raw Popcorn export needs no codec round trip at all: those
frames are already packed RGB, so they are widened to RGBA, filtered and packed
back down.

Audio-only exports have no frames, and take the ordinary single-pass route.

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
fx-stack.js               The effect stack and the panel that edits it
fx-pool.js                One filter worker per core, fed a frame at a time
fx-worker.js              Applies a stack to one frame; loads the shared filters
zip.js                    Store-only ZIP writer for the image sequence
vendor/ffmpeg/            @ffmpeg/ffmpeg 0.12.15 ESM client
jsDelivr (runtime)        @ffmpeg/core 0.12.10 single-thread core
vendor/PROVENANCE.md      Dependency source and license notes
```
