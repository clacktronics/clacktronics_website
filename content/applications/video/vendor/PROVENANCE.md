# Vendored media engine provenance

These files are shared: Video Lab and ClackMosh
(`content/applications/clackmosh/`) both import the client from here rather
than vendoring it twice, so the notices below cover both apps.

## ffmpeg.wasm client

- Package: `@ffmpeg/ffmpeg`
- Version: `0.12.15`
- Source: https://github.com/ffmpegwasm/ffmpeg.wasm
- Distributed files: `vendor/ffmpeg/*.js` from `dist/esm`
- License: MIT; see `LICENSE-ffmpeg.wasm.txt`

## ffmpeg.wasm core

- Package: `@ffmpeg/core`
- Version: `0.12.10`
- Source: https://github.com/ffmpegwasm/ffmpeg.wasm
- Runtime files: `ffmpeg-core.js` and `ffmpeg-core.wasm` from `dist/esm`,
  fetched from the pinned jsDelivr package URL on first use rather than stored
  in this repository
- The JavaScript wrapper project is MIT-licensed. The published core is built
  with FFmpeg's `--enable-gpl` plus x264, x265, libvpx, LAME, Theora, Vorbis,
  Opus, WebP, libass, and zimg. The combined WebAssembly binary is therefore
  GPL-covered; retain `COPYING.GPLv2.txt`, this provenance file, and the
  upstream source links when redistributing it.

Files were retrieved from jsDelivr's immutable, versioned npm package URLs.
