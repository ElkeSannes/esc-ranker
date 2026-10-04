"""Maakt app/icon-192.png en app/icon-512.png: een roze '12' op paars (douze points)."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

APP = Path(__file__).resolve().parent.parent / "app"

for size in (192, 512):
    img = Image.new("RGB", (size, size), "#140c2b")
    draw = ImageDraw.Draw(img)
    margin = size * 0.18  # binnen de "veilige zone" voor ronde Android-iconen
    draw.ellipse([margin, margin, size - margin, size - margin], fill="#ff3d8b")
    font = ImageFont.load_default(size=int(size * 0.32))
    draw.text((size / 2, size / 2), "12", font=font, fill="white", anchor="mm")
    img.save(APP / f"icon-{size}.png")
    print(f"icon-{size}.png gemaakt")
