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
  only committing an edit costs an encode. The sliders are folded away by
  default, because eight ranges stacked under the picture are eight things to
  catch with a thumb while scrolling, and each one is a change to the frame.
  A closed fold with uncommitted changes inside says so.
- Delete an anchor (the bloom), restore it, reset one frame, or reset the lot.
- **Mosh → Delete every anchor but the first**, which makes the opening picture
  last the whole video.
- **Mosh → Delete every P-frame after this anchor**, the opposite move: from
  the selected frame on, every run collapses to its own single picture and the
  tail of the video becomes a hard slideshow.
- Add more clips at the start, at the selected anchor, or at the end, and mosh
  them into each other.
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

## Working with anchors

One rule governs everything else: **an edited anchor is only as good as the
motion that follows it.** The picture you put in does not move on its own —
the P-frames after it are what drag it about, and if the camera was still and
the subject was still, they are describing almost nothing and your replacement
will just sit there like a slide. Before spending time on an anchor, look at
how much motion follows it. In the filmstrip the ticks are drawn per frame, so
a run sitting over a busy passage is where the effect lives; if in doubt,
preview the run first and edit second.

From that, the things actually worth doing:

- **Replace an anchor just before a pan, a zoom or someone walking through
  the shot.** The stronger and more coherent the movement, the more the
  replacement gets carried rather than merely dissolved.
- **Delete an anchor immediately after a cut.** That is where two unrelated
  pictures meet, so the incoming scene's motion is applied to the outgoing
  scene's picture — the largest possible mismatch, and the most dramatic
  bloom. Anchors on either side of a clip join are marked for exactly this
  reason.
- **Replace an anchor with the picture from the anchor before it.** A subtle
  one: the video appears to slip backwards in time while the movement carries
  straight on.
- **Scale or turn the picture before applying it.** The motion vectors were
  written for the original framing, so a rotated or blown-up picture is
  dragged in directions that no longer match its content.
- **Leave most anchors alone.** Editing every one gives a uniform mush; the
  effect reads as an effect when there is untouched footage either side of it
  to be surprised by.

The two bulk operations in the **Mosh** menu are the extremes of the same
dial, and both are worth trying once to see the ends of the range: delete
every anchor and nothing ever resets, delete every P-frame and nothing ever
moves.

## Moshing clips together

Frames are only interchangeable if the stream configuration they were encoded
under agrees, because the pixel dimensions and the sample aspect both end up
in the VOL header. So a clip added to a project is not merely re-encoded — it
is re-encoded to the project's exact frame, letterboxed rather than stretched,
with `setsar=1` and the same encoder settings. Do that and three clips from
three different sources, sizes and frame rates produce byte-identical VOL
headers, and their chunks can be spliced into one another freely.

A **join** is an anchor with another clip's picture in front of it. Delete it
and the incoming clip's motion is applied to the outgoing clip's last frame,
which is the difference between two videos moshed together and two videos cut
together. Joins are marked in the filmstrip, and **Clip → Mosh the joins**
deletes all of them at once.

Adding at the start creates a join at the far end of the incoming clip rather
than at its head — there is nothing in front of the first frame of the video
to mosh into, and deleting that anchor would only leave the file opening on a
P-frame. Adding in the middle creates a join at both ends.

Only the first clip's audio is kept. Everything else about the timing has
already stopped lining up by the time you are moshing joins.

## Encoding settings

These are applied as a clip is brought in, so changing them means a
re-import. They change the character of the smear rather than just the file
size:

| Setting | What it does |
| ------- | ------------ |
| Blockiness | The quantiser, 1–31. High values give coarse blocks and cheap residuals — the classic look. |
| Motion reach | `-me_range`. A short search cannot follow fast movement, so the encoder gives up into large, messy residuals and the smears get wilder. |
| Fine motion blocks | `-flags +mv4`: a motion vector per 8×8 block instead of per 16×16 macroblock, so smears break up more finely. |
| Sub-pixel motion | `-flags +qpel`: quarter-pixel vectors, for smoother, more liquid drags. |

Two omissions are deliberate. **`-me_method` is not offered because it does
nothing**: the mpeg4 encoder ignores it, and every value from `zero` to `full`
produces a byte-identical file. And B-frames stay off, because they would
break the model the whole app is built on — every frame being either a whole
picture you can edit or motion you leave alone.

## Practical limits

Everything runs in one tab, on the single-thread FFmpeg core, so the ceilings
are low on purpose: 60 seconds and 960 pixels wide at the outside, and the
defaults (20 seconds, 480 wide) are the comfortable range. Datamoshing is a
short-clip form anyway.

Adding clips is the only way to get near the ceiling of 3000 frames, and the
app refuses an import that would cross it.

Anchor spacing is the setting that matters most. A long gap gives few anchors
and long, luxurious smears; a short one gives many anchors and a choppier,
more collaged result. It cannot be changed after import without re-importing,
because it is an encoder setting.

On a phone the panels are reordered to follow the job — bring a clip in, pick
the anchor to work on, edit it, look at the result — rather than keeping the
desktop's two-column arrangement, which would bury the filmstrip under a
screenful of sliders.

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
