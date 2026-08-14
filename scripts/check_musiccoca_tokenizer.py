#!/usr/bin/env python3
"""Check audioGen's SentencePiece tokenizer against Google's implementation.

MusicCoCa — the text tower that turns an audioGen prompt into the style tokens
Magenta RealTime 2 is conditioned on — ships Google's original `spm.model`
protobuf rather than a HuggingFace tokenizer.json, so
content/applications/audiogen/mrt2/sentencepiece.js parses that file and does
the Unigram segmentation itself. A prompt that tokenizes differently from the
reference conditions the model differently and quietly produces the wrong
music, which is the kind of wrong that is easy to ship and hard to notice.

So this compares the two, piece for piece, over a corpus of prompt-shaped text.
It is not part of any build: run it by hand after touching the tokenizer.

    pip install sentencepiece
    python3 scripts/check_musiccoca_tokenizer.py

Needs node (to run the JS) and a copy of spm.model, which it fetches from the
Hugging Face repository the app loads it from and caches under /tmp.
"""

import json
import pathlib
import random
import subprocess
import sys
import tempfile
import urllib.request

MODEL_URL = (
    "https://huggingface.co/blanchon/magenta-realtime-2-onnx/resolve/main/"
    "musiccoca/spm.model"
)
TOKENIZER = pathlib.Path("content/applications/audiogen/mrt2/sentencepiece.js")

WORDS = """warm analog synth arpeggio drum machine lofi hiphop vinyl piano techno acid
house jungle breakbeat ambient drone tape hiss reverb delay 808 909 303 bpm guitar
strings cello violin choir vocal chop bass sub kick snare hat ride cymbal orchestral
cinematic tension bright dark moody uplifting slow fast triplet swing shuffle""".split()

EDGE_CASES = [
    "", "   ", "!!!", "a", "ü", "北京", "🎵🎶", "Ω≈ç√", "12345",
    "don't stop", "co-op / duo", "TEST", "\ttab\nnewline", "e" * 200,
    "Lo-fi hip hop beat, dusty vinyl, mellow electric piano",
    "café música electrónica con acordeón",
]


def corpus(count: int = 150) -> list[str]:
    random.seed(7)
    prompts = [
        " ".join(random.choices(WORDS, k=random.randint(1, 14))) for _ in range(count)
    ]
    prompts += [prompt.upper() for prompt in prompts[:15]]
    prompts += [
        ", ".join(random.choices(WORDS, k=random.randint(2, 8))) for _ in range(40)
    ]
    return prompts + EDGE_CASES


def fetch_model() -> pathlib.Path:
    cached = pathlib.Path(tempfile.gettempdir()) / "musiccoca-spm.model"
    if not cached.exists():
        print(f"fetching {MODEL_URL}")
        with urllib.request.urlopen(MODEL_URL) as response:
            cached.write_bytes(response.read())
    return cached


def encode_with_js(model: pathlib.Path, prompts: list[str]) -> list[list[int]]:
    """Run the app's own tokenizer, in node, over the same prompts."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(prompts, handle)
        prompts_path = handle.name

    script = f"""
      import {{ readFileSync }} from 'node:fs';
      const {{ loadSentencePiece }} = await import('{TOKENIZER.resolve().as_uri()}');
      const bytes = readFileSync({str(model)!r});
      const sp = loadSentencePiece(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const prompts = JSON.parse(readFileSync({prompts_path!r}, 'utf8'));
      console.log(JSON.stringify(prompts.map(t => sp.encode(t.toLowerCase()))));
    """
    try:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            capture_output=True, text=True, check=True,
        )
    finally:
        pathlib.Path(prompts_path).unlink(missing_ok=True)
    return json.loads(result.stdout)


def main() -> int:
    try:
        import sentencepiece
    except ImportError:
        print("pip install sentencepiece", file=sys.stderr)
        return 2

    model = fetch_model()
    prompts = corpus()
    reference = sentencepiece.SentencePieceProcessor(model_file=str(model))
    ours = encode_with_js(model, prompts)

    failures = 0
    for prompt, got in zip(prompts, ours):
        want = reference.encode(prompt.lower())
        if want == got:
            continue
        failures += 1
        print(f"MISMATCH {prompt!r:.60}")
        print(f"  reference {want}")
        print(f"  ours      {got}")

    print(f"{len(prompts) - failures}/{len(prompts)} prompts tokenize identically.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
