#!/usr/bin/env python3
"""Generates StockMonk PNG icons (16, 32, 48, 128 px) without any dependencies."""
import struct, zlib, math, os

def png(size):
    cx, cy = size / 2, size / 2

    def rounded_rect(x, y, r_corner):
        dx = abs(x - cx) - (cx - r_corner)
        dy = abs(y - cy) - (cy - r_corner)
        if dx <= 0 or dy <= 0:
            return abs(x - cx) <= cx and abs(y - cy) <= cy
        return dx * dx + dy * dy <= r_corner * r_corner

    # Chart points (normalised 0-1) — upward trending line
    points = [(0.12, 0.72), (0.30, 0.58), (0.48, 0.64), (0.67, 0.36), (0.88, 0.42)]

    def chart_y_at(nx):
        for i in range(len(points) - 1):
            x0, y0 = points[i]
            x1, y1 = points[i + 1]
            if x0 <= nx <= x1:
                t = (nx - x0) / (x1 - x0)
                return y0 + t * (y1 - y0)
        return None

    line_w = max(1.4, size * 0.055)
    dot_r  = max(1.2, size * 0.065)
    pad    = size * 0.08
    r_corner = size * 0.22

    rows = []
    for row in range(size):
        r_row = b'\x00'
        for col in range(size):
            nx = (col - pad) / (size - 2 * pad)
            ny = (row - pad) / (size - 2 * pad)

            in_bg = rounded_rect(col, row, r_corner)
            if not in_bg:
                r_row += bytes([0, 0, 0, 0])
                continue

            # Background gradient: #0a0e1a → #111827
            t_bg = row / size
            bg_r = int(10  + t_bg * 7)
            bg_g = int(14  + t_bg * 8)
            bg_b = int(26  + t_bg * 13)

            # Dot at last point
            lx = points[-1][0] * (size - 2*pad) + pad
            ly = points[-1][1] * (size - 2*pad) + pad
            if math.hypot(col - lx, row - ly) < dot_r:
                r_row += bytes([16, 185, 129, 255])
                continue

            # Chart line
            on_line = False
            cy_chart = chart_y_at(nx)
            if cy_chart is not None:
                py = cy_chart * (size - 2*pad) + pad
                if abs(row - py) < line_w:
                    on_line = True

            if on_line:
                r_row += bytes([16, 185, 129, 255])
            else:
                # Fill under line (gradient)
                fy = chart_y_at(nx)
                if fy is not None:
                    py = fy * (size - 2*pad) + pad
                    if row > py and row < size - pad:
                        depth = (row - py) / (size * 0.35)
                        alpha = int(max(0, 55 * (1 - depth)))
                        r_row += bytes([16, 185, 129, alpha])
                        continue
                r_row += bytes([bg_r, bg_g, bg_b, 255])

        rows.append(r_row)

    raw = b''.join(rows)
    compressed = zlib.compress(raw, 9)

    def chunk(name, data):
        crc = zlib.crc32(name + data) & 0xffffffff
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', crc)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', compressed)
            + chunk(b'IEND', b''))

os.makedirs('icons', exist_ok=True)
for s in [16, 32, 48, 128]:
    path = f'icons/icon{s}.png'
    with open(path, 'wb') as f:
        f.write(png(s))
    print(f'Created {path}')