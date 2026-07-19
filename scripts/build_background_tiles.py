"""Build the bitmap-only ClackOS desktop background tiles.

The tile designs used to be inline SVG strings in assets/js/clackos.js.  Their
editable source now lives here as drawing commands; the website only loads the
generated PNG files from assets/backgrounds/.
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "backgrounds"
SCALE = 4


def canvas(width, height):
    return Image.new("RGBA", (width * SCALE, height * SCALE), (0, 0, 0, 0))


def finish(image, name, size):
    image.resize(size, Image.Resampling.LANCZOS).save(OUTPUT / name, optimize=True)


def ellipse(draw, box, **kwargs):
    draw.ellipse(tuple(value * SCALE for value in box), **kwargs)


def line(draw, points, **kwargs):
    draw.line([(x * SCALE, y * SCALE) for x, y in points], **kwargs)


def polygon(draw, points, **kwargs):
    draw.polygon([(x * SCALE, y * SCALE) for x, y in points], **kwargs)


def build():
    OUTPUT.mkdir(parents=True, exist_ok=True)

    image = canvas(16, 16)
    ellipse(ImageDraw.Draw(image), (0, 0, 2, 2), fill="#c2b998")
    finish(image, "sand-dots.png", (16, 16))

    image = canvas(96, 96)
    draw = ImageDraw.Draw(image)
    for box in [(7, 9, 37, 31), (50, 18, 86, 42), (25, 46, 51, 78), (68, 67, 92, 85), (1, 77, 19, 91)]:
        ellipse(draw, box, fill="#cfc5a3", outline="#b7ac87", width=2 * SCALE)
    for box in [(13, 13, 25, 21), (56, 22, 70, 30), (31, 50, 39, 62)]:
        ellipse(draw, box, fill="#e9e2c8")
    finish(image, "pebbles.png", (96, 96))

    image = canvas(90, 90)
    draw = ImageDraw.Draw(image)
    for points, width in [
        ([(0, 30), (26, 36), (44, 22), (66, 34), (90, 30)], 2),
        ([(45, 0), (40, 22), (52, 50), (42, 72), (45, 90)], 2),
        ([(26, 36), (14, 60), (0, 64)], 2),
        ([(90, 64), (70, 60), (52, 50)], 2),
        ([(66, 34), (74, 14), (90, 10)], 2),
        ([(0, 10), (16, 14), (26, 36)], 1),
        ([(42, 72), (20, 80)], 1),
    ]:
        line(draw, points, fill="#a3986f", width=width * SCALE, joint="curve")
    finish(image, "cracked-earth.png", (90, 90))

    image = canvas(64, 64)
    draw = ImageDraw.Draw(image)
    # Sample the former quadratic waves densely to retain their woven shape.
    for y, colour in [(16, "#b9c4a0"), (48, "#b9c4a0")]:
        points = [(x, y - 8 * __import__("math").sin(__import__("math").pi * x / 16)) for x in range(65)]
        line(draw, points, fill=colour, width=2 * SCALE)
    for x in (16, 48):
        points = [(x - 8 * __import__("math").sin(__import__("math").pi * y / 16), y) for y in range(65)]
        line(draw, points, fill="#9db388", width=2 * SCALE)
    finish(image, "fern-weave.png", (64, 64))

    image = canvas(80, 80)
    draw = ImageDraw.Draw(image)
    line(draw, [(0, 20), (28, 20), (28, 52), (60, 52), (60, 80)], fill="#bcb28c", width=2 * SCALE)
    line(draw, [(40, 0), (40, 16), (68, 16), (68, 44), (80, 44)], fill="#bcb28c", width=2 * SCALE)
    for x, y in [(28, 20), (28, 52), (60, 52), (68, 16), (68, 44)]:
        ellipse(draw, (x - 3.5, y - 3.5, x + 3.5, y + 3.5), fill="#a89d73")
    finish(image, "circuit-trace.png", (80, 80))

    image = canvas(72, 72)
    draw = ImageDraw.Draw(image)
    for points in [
        [(12, 10), (22, 6), (26, 15), (15, 20)],
        [(52, 20), (61, 23), (57, 33), (48, 29)],
        [(28, 48), (36, 42), (43, 49), (34, 55)],
        [(60, 58), (67, 60), (64, 68), (57, 65)],
    ]:
        polygon(draw, points, fill="#c9bd94")
    for points in [
        [(40, 6), (46, 8), (44, 15), (37, 13)],
        [(8, 40), (15, 37), (19, 44), (11, 48)],
        [(14, 62), (22, 63), (21, 70), (13, 69)],
    ]:
        polygon(draw, points, fill="#a9bb95")
    finish(image, "terrazzo.png", (72, 72))


if __name__ == "__main__":
    build()
