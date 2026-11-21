"""Generate crisp 4x supersampled PNG icons for TideLock (16, 32, 48, 128 px)."""
from pathlib import Path
from PIL import Image, ImageDraw
import math

OUT_DIR = Path(__file__).resolve().parent.parent / "icons"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SIZES = [16, 32, 48, 128]


def lerp(a: float, b: float, t: float) -> int:
    return int(round(a + (b - a) * t))


def render_icon(size: int) -> Image.Image:
    scale = 4
    S = size * scale
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background rounded squircle with deep twilight-indigo gradient
    pad = max(2, int(S * 0.04))
    radius = int(S * 0.24)

    # Build gradient canvas
    grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gpx = grad.load()
    c1 = (15, 23, 42)     # #0F172A deep slate navy
    c2 = (30, 41, 82)     # #1E2952 midnight indigo
    c3 = (225, 29, 72)    # subtle crimson warmth at bottom-right
    for y in range(S):
        ty = y / max(1, S - 1)
        for x in range(S):
            tx = x / max(1, S - 1)
            diag = (tx + ty) * 0.5
            glow = max(0.0, 1.0 - math.hypot(tx - 0.88, ty - 0.88) / 0.72) ** 2 * 0.38
            r = lerp(c1[0], c2[0], diag)
            g = lerp(c1[1], c2[1], diag)
            b = lerp(c1[2], c2[2], diag)
            r = min(255, int(r + (c3[0] - r) * glow))
            g = min(255, int(g + (c3[1] - g) * glow))
            b = min(255, int(b + (c3[2] - b) * glow))
            gpx[x, y] = (r, g, b, 255)

    mask = Image.new("L", (S, S), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle([pad, pad, S - pad - 1, S - pad - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    # Subtle inner border highlight
    stroke_w = max(2, int(S * 0.02))
    draw.rounded_rectangle(
        [pad + stroke_w // 2, pad + stroke_w // 2, S - pad - stroke_w // 2 - 1, S - pad - stroke_w // 2 - 1],
        radius=max(2, radius - stroke_w // 2),
        outline=(255, 255, 255, 36),
        width=stroke_w,
    )

    cx, cy = S * 0.5, S * 0.5

    # Outer tidal-lock orbit ring (270-degree sleek arc in luminous cyan-teal)
    ring_r = S * 0.315
    ring_w = max(3, int(S * 0.072))
    bbox = [cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r]
    draw.arc(bbox, start=210, end=120, fill=(56, 189, 248, 255), width=ring_w)  # #38BDF8 sky cyan

    # Second complementary warm coral lock segment completing the tidal lock motif
    draw.arc(bbox, start=138, end=192, fill=(251, 113, 133, 255), width=ring_w)  # #FB7185 coral rose

    # Tidal anchor dot at the orbit lock node (top-left gap)
    dot_angle = math.radians(165)
    dot_r = ring_w * 0.62
    dx = cx + ring_r * math.cos(dot_angle)
    dy = cy + ring_r * math.sin(dot_angle)
    draw.ellipse([dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r], fill=(255, 255, 255, 255))

    # Centered crisp Play triangle (representing the anchored video feed)
    tri_r = S * 0.165
    offset_x = S * 0.025
    pts = [
        (cx - tri_r * 0.72 + offset_x, cy - tri_r * 0.92),
        (cx - tri_r * 0.72 + offset_x, cy + tri_r * 0.92),
        (cx + tri_r * 1.05 + offset_x, cy),
    ]
    draw.polygon(pts, fill=(248, 250, 252, 255))

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    for size in SIZES:
        icon = render_icon(size)
        out_path = OUT_DIR / f"icon-{size}.png"
        icon.save(out_path, format="PNG", optimize=True)
        print(f"Generated {out_path} ({icon.size[0]}x{icon.size[1]})")


if __name__ == "__main__":
    main()
