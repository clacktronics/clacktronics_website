# ClackMosh

A datamosher for ClackOS. It runs both as its own page and inside a ClackOS
iframe window, and nothing is uploaded anywhere.

## What it does

Open a video and ClackMosh re-encodes it into MPEG-4 Part 2 with no B-frames,
so every frame is one of two things:

- an **anchor** (an I-frame) — a whole picture, standing on its own
- **motion** (a P-frame) — instructions for shoving the previous picture about,
  with no picture of its own

You edit the anchors. The motion is never touched, and that is the entire
trick: it goes on describing the movement of a picture that is no longer
there. Replace an anchor and the original video's movement drags your
replacement around the screen. Delete one and the picture never resets, so the
smear runs on through what should have been a fresh start.

## What works

- A filmstrip of every frame, anchors as thumbnails and motion as ticks, so the
  structure of the file is the thing you navigate.
- Replace an anchor with an imported image, with the picture from another
  anchor, or with the original.
- Scale, move, turn and flip the picture inside the frame; hue, saturation,
  contrast, brightness and invert on top. All of it redraws live on a canvas —
  only committing an edit costs an encode.
- Delete an anchor (the bloom), restore it, reset one frame, or reset the lot.
- **Mosh → Delete every anchor but the first**, which makes the opening picture
  last the whole video.
- Preview just the run of frames the selected anchor governs, which comes back
  in a second or two, or render the whole video.
- Export the rendered MP4, or the moshed AVI itself.
- Drag and drop, and `Ctrl+O` / `Ctrl+E` / `Ctrl+Enter` / `Ctrl+P` / `Ctrl+R`
  / `Delete`.

## Run it

A static app with no package manager or build step:

```sh
python -m http.server 8000
```

From the repository root, open
`http://localhost:8000/content/applications/clackmosh/`. Opening `index.html`
over `file://` will not work, because browsers do not permit the module worker
and WebAssembly fetches in that mode.

It can also be opened straight onto a clip, the same way Video Lab can:

```markdown
[Open in ClackMosh](app:applications/clackmosh/index.html?src=content%2Fmedia%2Fdemo.mp4)
```

## Why MPEG-4 Part 2, and not H.264

Datamoshing needs two things a modern pipeline is built to prevent: frames you
can address as discrete bytes, and a decoder that conceals a broken reference
instead of giving up.

An AVI gives the first. Every frame is its own `00dc` chunk in the `movi` list,
so deleting or replacing one is byte surgery — no index rewriting beyond
regenerating `idx1`. MPEG-4 Part 2 makes the frame map free as well: the two
bits after the VOP start code (`00 00 01 B6`) give the picture type, so the
whole I/P structure is readable without decoding anything.

H.264 in MP4 gives neither. Sample sizes and offsets live in the `stsz`/`stco`/
`stsc` tables, so nothing can move without rewriting them; and breaking
`frame_num` continuity or pointing a reference list at a missing picture makes
decoders throw or reset rather than smear. That is why every import is
normalised rather than edited in place.

The decode side needs `-err_detect ignore_err -ec favor_inter`. Without
`favor_inter` a missing anchor tends to freeze or drop the run instead of
letting the motion carry on, which throws the effect away.

## Splicing a replacement anchor

An I-frame chunk carries its own `VOS`/`VO`/`VOL`/`GOV` headers ahead of the
picture. Those describe the stream and encode the run's timecode, so a
replacement keeps the original chunk's header bytes verbatim and swaps only the
payload from the VOP start code onwards. Re-encoding a single still with the
same settings otherwise produces a header that differs by one byte — the GOV
timecode — which is exactly the sort of small disagreement a decoder is
entitled to object to.

## Practical limits

Everything runs in one tab, on the single-thread FFmpeg core, so the ceilings
are low on purpose: 60 seconds and 960 pixels wide at the outside, and the
defaults (20 seconds, 480 wide) are the comfortable range. Datamoshing is a
short-clip form anyway.

Anchor spacing is the setting that matters most. A long gap gives few anchors
and long, luxurious smears; a short one gives many anchors and a choppier,
more collaged result. It cannot be changed after import without re-importing,
because it is an encoder setting.

Deleting frames shortens the video and the audio does not follow, so **Keep
audio** re-muxes the original track at its original timing and lets it drift.
That is normally what you want from a mosh.

The moshed AVI is the authentic artefact, but it is a deliberately broken file
and browsers will not play it — VLC and FFmpeg will. The MP4 export is the one
to send to anyone else: the smear is baked into its pixels, so it plays
anywhere.

Previews follow what the browser admits it can decode. Chromium builds without
the proprietary codecs — the ones most Linux distributions ship — cannot play
H.264, so previews are rendered as WebM there instead. Exports stay MP4.

## Project layout

```text
index.html        App markup and controls
styles.css        ClackOS-derived standalone theme
main.js           Filmstrip, anchor editor, preview and render
avi.js            RIFF/AVI parsing, VOP typing and file rebuilding
mosh-engine.js    Normalising, thumbnails, still encoding and rendering
```

The FFmpeg client is shared with Video Lab (`../video/vendor/ffmpeg/`) rather
than vendored a second time, and the core is fetched from the pinned jsDelivr
URL on first use. Licence notices and provenance live in `../video/vendor/`.
