"""Render the project-owned SVG with the existing Playwright dependency."""
from io import BytesIO
from pathlib import Path
import struct

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "frontend/assets/images"


def main():
    svg = (ASSETS / "surveyone-mark.svg").read_text(encoding="utf-8")
    sizes = (16, 32, 48, 64, 128, 256)
    images = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(device_scale_factor=1)
        for size in (*sizes, 180, 192, 512):
            page.set_viewport_size({"width": size, "height": size})
            page.set_content('<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>' + svg)
            png = page.screenshot(omit_background=True)
            if size in sizes:
                images.append((size, png))
            else:
                (ASSETS / f"surveyone-icon-{size}.png").write_bytes(png)
        browser.close()
    # ICO supports PNG frames; keep all Windows shell and browser sizes.
    output = BytesIO()
    output.write(struct.pack("<HHH", 0, 1, len(images)))
    offset = 6 + 16 * len(images)
    for size, png in images:
        output.write(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(png), offset))
        offset += len(png)
    for _, png in images:
        output.write(png)
    (ASSETS / "surveyone.ico").write_bytes(output.getvalue())
    print("Built IN-SURVEYONE ICO (16-256px) and PNG (180/192/512px).")


if __name__ == "__main__":
    main()
