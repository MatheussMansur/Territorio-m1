"""Monta os ícones da casa a partir da raiz (história 4.8, UX-DR-20): o favicon SVG, os tamanhos PNG
das abas, da tela inicial e de app, e o favicon.ico, para o site e para o painel.

A raiz é contornada a partir de public/img/marca/raiz-mascara.png (o desenho grosso usado como máscara
nas páginas) e vira um caminho vetorial, desenhado em papel claro sobre um quadrado terracota: cantos retos,
como tudo na casa. O ícone maskable deixa a raiz dentro do círculo seguro (80 %).

Rode da raiz do repositório:  python scripts/site/build_icons.py
Precisa de: opencv-python, numpy, Pillow (gratuitos).
"""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MARCA = ROOT / "public" / "img" / "marca"
SOURCE = MARCA / "raiz-mascara.png"
BACK = "#A54829"  # --terracota
INK = "#F6F0E3"  # --papel-claro
# os tamanhos para onde os manifestos e o <head> apontam; scripts/site/icons.js confere no build
SIZES = [16, 32, 48, 180, 192, 512]


def shape():
    """A raiz como máscara 0/255, quadrada, a partir do alfa do desenho (ou dos traços escuros)."""
    img = Image.open(SOURCE).convert("RGBA")
    rgba = np.array(img)
    alpha = rgba[:, :, 3]
    dark = 255 - rgba[:, :, :3].mean(axis=2).astype(np.uint8)
    mask = np.where(alpha.min() < 250, alpha, dark)
    return np.where(mask > 127, 255, 0).astype(np.uint8)


def svg_path(mask, size=480, scale=1.0):
    """Os contornos (com furos) como um caminho só numa caixa size × size, a raiz escalada em volta do centro."""
    contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    h, w = mask.shape
    k = size / max(h, w) * scale
    ox = (size - w * k) / 2
    oy = (size - h * k) / 2
    parts = []
    for c in contours:
        if cv2.contourArea(c) < 6:
            continue
        c = cv2.approxPolyDP(c, 0.6, True)
        pts = [f"{x * k + ox:.1f} {y * k + oy:.1f}" for [[x, y]] in c]
        parts.append("M" + " L".join(pts) + "Z")
    return " ".join(parts)


def write_svg(mask, name, scale):
    path = svg_path(mask, 480, scale)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480">'
        f'<rect width="480" height="480" fill="{BACK}"/>'
        f'<path fill="{INK}" fill-rule="evenodd" d="{path}"/></svg>\n'
    )
    (MARCA / name).write_text(svg, encoding="utf-8")
    return svg


def png(mask, size, scale):
    """A raiz em papel claro sobre terracota, size × size, desenhada grande e reduzida (bordas lisas)."""
    big = 1024
    m = Image.fromarray(mask).resize((int(big * scale), int(big * scale)), Image.LANCZOS)
    layer = Image.new("L", (big, big), 0)
    layer.paste(m, ((big - m.width) // 2, (big - m.height) // 2))
    out = Image.new("RGBA", (big, big), BACK)
    ink = Image.new("RGBA", (big, big), INK)
    out.paste(ink, (0, 0), layer)
    return out.resize((size, size), Image.LANCZOS)


def main():
    mask = shape()
    svg = write_svg(mask, "icone.svg", 0.86)
    (ROOT / "public" / "favicon.svg").write_text(svg, encoding="utf-8")
    for size in SIZES:
        # aba pequena precisa da raiz maior no quadrado para dar para ver
        png(mask, size, 0.96 if size <= 48 else 0.86).save(MARCA / f"icone-{size}.png", optimize=True)
    png(mask, 512, 0.62).save(MARCA / "icone-mascaravel-512.png", optimize=True)
    icons = [png(mask, s, 0.96) for s in (16, 32, 48)]
    icons[0].save(ROOT / "public" / "favicon.ico", sizes=[(s, s) for s in (16, 32, 48)], append_images=icons[1:])
    print("ícones:", ", ".join([f"icone-{s}.png" for s in SIZES] + ["icone-mascaravel-512.png", "icone.svg", "favicon.svg", "favicon.ico"]))


if __name__ == "__main__":
    main()
