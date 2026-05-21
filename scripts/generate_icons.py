"""Generate Aoroza app icons at all required sizes."""
from PIL import Image, ImageDraw
import os

ICONS_DIR = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")

# Colors
BG = (99, 102, 241)     # indigo-500
ACCENT = (139, 92, 246)  # violet-500
FG = (255, 255, 255)

def draw_icon(size: int) -> Image.Image:
    """Draw Aoroza logo: rounded square with markdown-inspired 'M'."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = size * 0.06
    r = size * 0.18

    # Background: rounded rectangle
    draw.rounded_rectangle(
        [pad, pad, size - pad - 1, size - pad - 1],
        radius=r, fill=BG,
    )

    # Markdown-style "M" letterform as strokes
    cx, cy = size / 2, size / 2
    m_w = size * 0.40   # M width
    m_h = size * 0.50   # M height
    t = max(2, size * 0.065)  # stroke thickness

    xl = cx - m_w / 2
    xr = cx + m_w / 2
    xm = cx
    yt = cy - m_h / 2
    yb = cy + m_h / 2

    coords = [
        # left leg: top-left → bottom-left
        (xl, yt, xl, yb),
        # V-shaped center: bottom-left → center-top → bottom-right
        (xl, yb, xm, yt),
        (xm, yt, xr, yb),
        # right leg: bottom-right → top-right
        (xr, yb, xr, yt),
    ]

    for line in coords:
        draw.line(line, fill=FG, width=int(t))

    return img

def main():
    sizes = {
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
    }

    os.makedirs(ICONS_DIR, exist_ok=True)

    for filename, px in sizes.items():
        img = draw_icon(px)
        img.save(os.path.join(ICONS_DIR, filename), "PNG")
        print(f"  {filename} ({px}x{px})")

    # icon.png = 512x512 master
    draw_icon(512).save(os.path.join(ICONS_DIR, "icon.png"), "PNG")
    print("  icon.png (512x512)")

    # icon.ico = multi-res
    ico_frames = [draw_icon(s) for s in [32, 64, 128, 256]]
    ico_frames[0].save(
        os.path.join(ICONS_DIR, "icon.ico"), "ICO",
        sizes=[(s, s) for s in [32, 64, 128, 256]],
        append_images=ico_frames[1:],
    )
    print("  icon.ico (32+64+128+256)")

    # icon.icns — macOS (PNG fallback)
    draw_icon(256).save(os.path.join(ICONS_DIR, "icon.icns"), "PNG")
    print("  icon.icns (256x256)")

    # StoreLogo
    draw_icon(256).save(os.path.join(ICONS_DIR, "StoreLogo.png"), "PNG")
    print("  StoreLogo.png (256x256)")

    print("\nDone! Generated 20 icon files.")

if __name__ == "__main__":
    main()
