"""Generate store submission graphics for Microsoft Edge Add-ons ($0) & Chrome Web Store."""
from pathlib import Path
import importlib.util
import math
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "store-assets"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Load render_icon from generate-icons.py
spec = importlib.util.spec_from_file_location("gen_icons", ROOT / "scripts" / "generate-icons.py")
gen_icons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen_icons)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = (
        [
            "C:/Windows/Fonts/msyhbd.ttc",
            "C:/Windows/Fonts/segoeuib.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
        ]
        if bold
        else [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ]
    )
    for fp in candidates:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


def make_gradient_bg(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h))
    px = img.load()
    c1 = (11, 18, 36)
    c2 = (22, 35, 68)
    cyan = (14, 165, 233)
    rose = (225, 29, 72)
    for y in range(h):
        ty = y / max(1, h - 1)
        for x in range(w):
            tx = x / max(1, w - 1)
            diag = (tx + ty) * 0.5
            r = int(c1[0] + (c2[0] - c1[0]) * diag)
            g = int(c1[1] + (c2[1] - c1[1]) * diag)
            b = int(c1[2] + (c2[2] - c1[2]) * diag)
            g_cyan = max(0.0, 1.0 - math.hypot((tx - 0.18) * 1.2, (ty - 0.25) * 1.2)) ** 2 * 0.24
            g_rose = max(0.0, 1.0 - math.hypot((tx - 0.88) * 1.2, (ty - 0.85) * 1.2)) ** 2 * 0.28
            r = min(255, int(r + (cyan[0] - r) * g_cyan + (rose[0] - r) * g_rose))
            g = min(255, int(g + (cyan[1] - g) * g_cyan + (rose[1] - g) * g_rose))
            b = min(255, int(b + (cyan[2] - b) * g_cyan + (rose[2] - b) * g_rose))
            px[x, y] = (r, g, b)
    return img


def build_edge_logo() -> Path:
    logo = gen_icons.render_icon(300)
    out = OUT_DIR / "edge-logo-300x300.png"
    logo.save(out, format="PNG", optimize=True)
    return out


def build_small_promo() -> Path:
    w, h = 440, 280
    bg = make_gradient_bg(w, h).convert("RGBA")
    draw = ImageDraw.Draw(bg, "RGBA")

    icon = gen_icons.render_icon(92)
    bg.paste(icon, ((w - 92) // 2, 34), icon)

    f_title = load_font(34, bold=True)
    f_sub = load_font(15, bold=False)
    f_pill = load_font(12, bold=True)

    title = "TideLock"
    tb = draw.textbbox((0, 0), title, font=f_title)
    draw.text(((w - (tb[2] - tb[0])) // 2, 138), title, fill=(248, 250, 252, 255), font=f_title)

    sub = "Keep Your YouTube Home Feed Intact"
    sb = draw.textbbox((0, 0), sub, font=f_sub)
    draw.text(((w - (sb[2] - sb[0])) // 2, 184), sub, fill=(148, 163, 184, 255), font=f_sub)

    pill_text = "Zero Extra Tabs  ·  Undo Refresh  ·  100% Local"
    pb = draw.textbbox((0, 0), pill_text, font=f_pill)
    pw = (pb[2] - pb[0]) + 28
    px0 = (w - pw) // 2
    draw.rounded_rectangle([px0, 222, px0 + pw, 250], radius=14, fill=(18, 46, 74, 255), outline=(56, 189, 248, 255), width=1)
    draw.text(((w - (pb[2] - pb[0])) // 2, 228), pill_text, fill=(125, 211, 252, 255), font=f_pill)

    out = OUT_DIR / "small-promo-440x280.png"
    bg.convert("RGB").save(out, format="PNG", optimize=True)
    return out


def build_hero_screenshot() -> Path:
    w, h = 1280, 800
    bg = make_gradient_bg(w, h).convert("RGBA")
    draw = ImageDraw.Draw(bg, "RGBA")

    # Left Hero Copy
    icon = gen_icons.render_icon(76)
    bg.paste(icon, (72, 76), icon)

    f_brand = load_font(44, bold=True)
    f_tag = load_font(20, bold=True)
    f_h1 = load_font(36, bold=True)
    f_body = load_font(19, bold=False)
    f_card_t = load_font(18, bold=True)
    f_card_s = load_font(15, bold=False)
    f_ui_b = load_font(16, bold=True)
    f_ui = load_font(14, bold=False)

    draw.text((166, 84), "TideLock", fill=(248, 250, 252, 255), font=f_brand)
    draw.rounded_rectangle([376, 98, 456, 128], radius=10, fill=(18, 46, 74, 255), outline=(56, 189, 248, 255), width=1)
    draw.text((391, 102), "v2.2.0", fill=(125, 211, 252, 255), font=f_ui_b)

    draw.text((72, 186), "Stop YouTube Home From", fill=(248, 250, 252, 255), font=f_h1)
    draw.text((72, 232), "Refreshing On Back.", fill=(56, 189, 248, 255), font=f_h1)
    draw.text(
        (72, 294),
        "Watch a video for 30 minutes, hit Back — your exact\nHome feed & scroll spot stay right where you left them.",
        fill=(203, 213, 225, 255),
        font=f_body,
        spacing=8,
    )

    features = [
        ("Automatic Feed Tidal-Lock", "Intercepts surprise Home refreshes & stitches scrolled pages"),
        ("One-Click Undo Refresh", "Accidentally hit F5? Restore the previous batch right back"),
        ("Local Snapshots & No-Shorts Filter", "Search CN/EN titles, pin videos, export clean Markdown"),
        ("100% Local & Privacy-First", "Zero external requests, zero tracking, Manifest V3 open source"),
    ]
    fy = 382
    for title, desc in features:
        draw.rounded_rectangle([72, fy, 640, fy + 82], radius=14, fill=(15, 23, 42, 185), outline=(148, 163, 184, 48), width=1)
        draw.ellipse([94, fy + 33, 106, fy + 45], fill=(56, 189, 248, 255))
        draw.text((122, fy + 16), title, fill=(248, 250, 252, 255), font=f_card_t)
        draw.text((122, fy + 45), desc, fill=(148, 163, 184, 255), font=f_card_s)
        fy += 96

    # Right Mockup: TideLock v2.2.0 Popup + Floating Dock preview
    px, py, pw, ph = 716, 72, 492, 656
    draw.rounded_rectangle([px, py, px + pw, py + ph], radius=22, fill=(255, 255, 255, 250), outline=(226, 232, 240, 255), width=2)

    # Popup Header
    mini_icon = gen_icons.render_icon(34)
    bg.paste(mini_icon, (px + 24, py + 22), mini_icon)
    draw.text((px + 70, py + 20), "TideLock", fill=(15, 23, 42, 255), font=load_font(20, bold=True))
    draw.text((px + 70, py + 46), "Feed Lock Active · 首页潮汐锁定中", fill=(2, 132, 199, 255), font=load_font(13, bold=True))
    # Toggle switch
    draw.rounded_rectangle([px + pw - 74, py + 28, px + pw - 24, py + 56], radius=14, fill=(2, 132, 199, 255))
    draw.ellipse([px + pw - 49, py + 31, px + pw - 27, py + 53], fill=(255, 255, 255, 255))

    draw.line([px + 1, py + 76, px + pw - 1, py + 76], fill=(226, 232, 240, 255), width=1)

    # Stats Row
    stats = [("12", "Refreshes Blocked"), ("3", "Saved Snapshots"), ("4", "Pinned Queue")]
    sx = px + 24
    sw = 140
    for val, lbl in stats:
        draw.rounded_rectangle([sx, py + 92, sx + sw, py + 158], radius=12, fill=(241, 245, 249, 255))
        vb = draw.textbbox((0, 0), val, font=load_font(24, bold=True))
        draw.text((sx + (sw - (vb[2] - vb[0])) // 2, py + 100), val, fill=(15, 23, 42, 255), font=load_font(24, bold=True))
        lb = draw.textbbox((0, 0), lbl, font=load_font(12, bold=False))
        draw.text((sx + (sw - (lb[2] - lb[0])) // 2, py + 134), lbl, fill=(100, 116, 139, 255), font=load_font(12, bold=False))
        sx += sw + 12

    # Action Buttons
    draw.rounded_rectangle([px + 24, py + 174, px + 172, py + 212], radius=10, fill=(2, 132, 199, 255))
    draw.text((px + 50, py + 184), "Open Drawer", fill=(255, 255, 255, 255), font=f_ui_b)
    draw.rounded_rectangle([px + 184, py + 174, px + 332, py + 212], radius=10, fill=(254, 243, 199, 255))
    draw.text((px + 206, py + 184), "Undo Refresh", fill=(217, 119, 6, 255), font=f_ui_b)
    draw.rounded_rectangle([px + 344, py + 174, px + pw - 24, py + 212], radius=10, fill=(241, 245, 249, 255), outline=(203, 213, 225, 255))
    draw.text((px + 365, py + 184), "Fresh Feed", fill=(15, 23, 42, 255), font=f_ui_b)

    # Filter Pills
    pills = [("All", True), ("Unwatched", False), ("Watched", False), ("No Shorts", True)]
    fx = px + 24
    for ptxt, active in pills:
        pb = draw.textbbox((0, 0), ptxt, font=load_font(13, bold=True))
        pw_chip = (pb[2] - pb[0]) + 24
        fill = (2, 132, 199, 255) if active else (241, 245, 249, 255)
        tcol = (255, 255, 255, 255) if active else (71, 85, 105, 255)
        draw.rounded_rectangle([fx, py + 230, fx + pw_chip, py + 260], radius=15, fill=fill)
        draw.text((fx + 12, py + 237), ptxt, fill=tcol, font=load_font(13, bold=True))
        fx += pw_chip + 8

    # Sample Cards (100% generic synthetic placeholders — zero personal data!)
    sample_cards = [
        ("System Design: Building Fast SPAs", "Engineering Channel · 180K views", "24:15", (14, 116, 144)),
        ("Modern TypeScript Patterns for 2026", "Dev Insights · 94K views", "18:42", (79, 70, 229)),
        ("How Orbital Tidal Locking Works", "Astro Physics Lab · 1.2M views", "14:08", (190, 24, 93)),
        ("Zero-Dependency Extension Design", "Web Platform · 62K views", "31:50", (15, 118, 110)),
    ]
    cy = py + 282
    for title, meta, dur, col in sample_cards:
        draw.rounded_rectangle([px + 20, cy, px + pw - 20, cy + 78], radius=12, fill=(248, 250, 252, 255))
        draw.rounded_rectangle([px + 30, cy + 10, px + 148, cy + 68], radius=8, fill=(*col, 255))
        draw.rounded_rectangle([px + 104, cy + 48, px + 144, cy + 64], radius=4, fill=(15, 23, 42, 215))
        draw.text((px + 108, cy + 49), dur, fill=(255, 255, 255, 255), font=load_font(11, bold=True))
        draw.text((px + 162, cy + 14), title, fill=(15, 23, 42, 255), font=load_font(14, bold=True))
        draw.text((px + 162, cy + 42), meta, fill=(100, 116, 139, 255), font=load_font(12, bold=False))
        cy += 88

    # Bottom Toast Pill inside card
    toast_txt = "Home feed preserved (96)  ·  1-Click Back"
    tb = draw.textbbox((0, 0), toast_txt, font=f_ui)
    tw = (tb[2] - tb[0]) + 46
    tx0 = px + (pw - tw) // 2
    draw.rounded_rectangle([tx0, py + ph - 48, tx0 + tw, py + ph - 14], radius=17, fill=(15, 23, 42, 240))
    draw.ellipse([tx0 + 14, py + ph - 36, tx0 + 24, py + ph - 26], fill=(56, 189, 248, 255))
    draw.text((tx0 + 32, py + ph - 40), toast_txt, fill=(248, 250, 252, 255), font=f_ui)

    out = OUT_DIR / "screenshot-hero-1280x800.png"
    bg.convert("RGB").save(out, format="PNG", optimize=True)
    return out


if __name__ == "__main__":
    for fn in (build_edge_logo, build_small_promo, build_hero_screenshot):
        p = fn()
        im = Image.open(p)
        print(f"Generated {p} ({im.size[0]}x{im.size[1]})")
