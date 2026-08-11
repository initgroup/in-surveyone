from __future__ import annotations

from html import escape

import qrcode
from qrcode.constants import ERROR_CORRECT_Q


def create_qr_svg(value: str) -> bytes:
    target = value.strip()
    if not target or len(target.encode("utf-8")) > 2048:
        raise ValueError("QR target must contain between 1 and 2048 UTF-8 bytes.")

    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_Q,
        box_size=1,
        border=4,
    )
    qr.add_data(target, optimize=0)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    size = len(matrix)
    path = "".join(
        f"M{column},{row}h1v1h-1z"
        for row, modules in enumerate(matrix)
        for column, dark in enumerate(modules)
        if dark
    )
    accessible_target = escape(target, quote=True)
    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        'role="img" aria-labelledby="qr-title qr-description" '
        'shape-rendering="crispEdges">'
        '<title id="qr-title">IN-SURVEYONE 설문 참여 QR 코드</title>'
        f'<desc id="qr-description">{accessible_target}</desc>'
        f'<rect width="{size}" height="{size}" fill="#ffffff"/>'
        f'<path d="{path}" fill="#07162d"/>'
        "</svg>"
    )
    return svg.encode("utf-8")
