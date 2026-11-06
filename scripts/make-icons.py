from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

margin = 58
radius = 232
rect = (margin, margin, SIZE - margin, SIZE - margin)

# Soft vertical terracotta gradient.
gradient = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gdraw = ImageDraw.Draw(gradient)
top = (224, 116, 78)
bottom = (184, 68, 41)
for y in range(SIZE):
    t = y / max(1, SIZE - 1)
    color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
    gdraw.line([(0, y), (SIZE, y)], fill=color)

mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle(rect, radius=radius, fill=255)
img.paste(gradient, (0, 0), mask)

# Inner highlight along the top edge.
highlight = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
hdraw = ImageDraw.Draw(highlight)
hdraw.rounded_rectangle(
    (margin + 18, margin + 18, SIZE - margin - 18, SIZE - margin - 18),
    radius=radius - 16,
    outline=(255, 255, 255, 46),
    width=9,
)
img.alpha_composite(highlight)

# Progress rising line.
points = [(292, 666), (442, 522), (566, 626), (748, 390)]
cream = (255, 248, 238, 255)
line_width = 72
d = ImageDraw.Draw(img)
d.line(points, fill=cream, width=line_width, joint="curve")
for x, y in (points[0], points[-1]):
    r = line_width // 2
    d.ellipse((x - r, y - r, x + r, y + r), fill=cream)

# Endpoint dot.
d.ellipse((748 - 57, 390 - 57, 748 + 57, 390 + 57), fill=(255, 248, 238, 255))
d.ellipse((748 - 28, 390 - 28, 748 + 28, 390 + 28), fill=(206, 87, 55, 255))

# Downsample for crisp small sizes.
master = img.resize((512, 512), Image.LANCZOS)
master.save(ASSETS / "icon.png")

ico = img.resize((256, 256), Image.LANCZOS)
ico.save(
    ASSETS / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

tray = img.resize((64, 64), Image.LANCZOS)
tray.save(ASSETS / "tray.png")

print("wrote", ASSETS / "icon.png", ASSETS / "icon.ico", ASSETS / "tray.png")
