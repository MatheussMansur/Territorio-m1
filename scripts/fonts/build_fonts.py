"""Monta as fontes servidas pelo próprio site: public/fonts/*.woff2 e src/styles/fonts.css.

- As famílias do Google vêm como os arquivos WOFF2 variáveis que o Google serve aos navegadores,
  só os recortes latin e latin-ext (eles já cobrem o português).
- A Nanum Pen Script não tem nenhuma letra acentuada, então é refeita: cada
  letra acentuada é composta do glifo base da própria fonte mais os traços
  de acento dela (veja patch_nanum), e depois recortada para o latino.
- A Oferta do Dia (os títulos do manual da marca) não é fonte do Google e os termos dela proíbem
  mudá-la sem permissão da autora: até lá o TTF original é copiado como
  está, nunca recortado nem convertido. Ela fica fora do git (scripts/fonts/originais/, veja
  .gitignore). Quando a permissão por escrito da autora para a web estiver salva ao lado como
  scripts/fonts/originais/PERMISSAO.txt, o build faz o WOFF2 só com os caracteres
  que o site usa (história 4.9, UX-DR-11) em vez de copiar o TTF.
- A Londrina Solid (OFL, Google) é o plano B dos títulos (UX-DR-12): sempre montada, nunca carregada
  até o token --f-letreiro apontar para ela (--f-letreiro-b em src/site/live.css).
- Termina conferindo a cobertura: toda família tem que desenhar todo caractere que usamos.

Rode da raiz do repositório:  python scripts/fonts/build_fonts.py
Só algumas famílias:          python scripts/fonts/build_fonts.py --so "Londrina Solid,Oferta do Dia"
Precisa de: fonttools, brotli.
"""
import io
import math
import re
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "fonts"
CSS = ROOT / "src" / "styles" / "fonts.css"
CHROME = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0 Safari/537.36"
)

# família, consulta do css2, nome do arquivo
GOOGLE = [
    ("Familjen Grotesk", "Familjen+Grotesk:wght@400..700", "familjen-grotesk"),
    ("Archivo", "Archivo:wdth,wght@75..100,400..800", "archivo"),
    ("IBM Plex Mono", "IBM+Plex+Mono:wght@400;600", "ibm-plex-mono"),
    ("Shojumaru", "Shojumaru", "shojumaru"),
    ("Chakra Petch", "Chakra+Petch:ital,wght@1,400;1,500", "chakra-petch"),
    # o plano B dos títulos, só entra pela troca do token --f-letreiro (UX-DR-12)
    ("Londrina Solid", "Londrina+Solid:wght@400;900", "londrina-solid"),
]
KEEP_SUBSETS = ("latin", "latin-ext")
ORIGINALS = Path(__file__).resolve().parent / "originais"
OFERTA = ("Oferta do Dia", "Oferta-do-Dia.ttf", "oferta-do-dia.ttf")
PERMISSION = ORIGINALS / "PERMISSAO.txt"

# Tudo o que o site escreve em português e espanhol, o mácron do logo e a pontuação que usamos.
REQUIRED = (
    "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑōŌ¿¡"
    "ªº°·–—‘’“”…•×"
)


def fetch(url, ua=CHROME):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": ua}), timeout=30).read()


def google_family(family, query, slug):
    css = fetch(f"https://fonts.googleapis.com/css2?family={query}&display=swap").decode()
    blocks = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*{[^}]*})", css)
    faces, files = [], {}
    for subset_name, block in blocks:
        if subset_name not in KEEP_SUBSETS:
            continue
        url = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
        style = re.search(r"font-style:\s*(\w+)", block).group(1)
        weight = re.search(r"font-weight:\s*([\d ]+);", block).group(1).strip()
        stretch = re.search(r"font-stretch:\s*([\d% ]+);", block)
        urange = re.search(r"unicode-range:\s*([^;]+);", block).group(1).strip()
        if url not in files:
            files[url] = f"{slug}-{subset_name}-{style}-{weight.replace(' ', '-')}.woff2"
            (OUT / files[url]).write_bytes(fetch(url))
        faces.append((family, style, weight, stretch.group(1).strip() if stretch else None, files[url], urange))
    return faces


def patch_nanum():
    """Nanum Pen Script com os acentos do português, desenhados com os traços dela mesma."""
    css = fetch("https://fonts.googleapis.com/css2?family=Nanum+Pen+Script", ua="").decode()
    ttf = TTFont(io.BytesIO(fetch(re.findall(r"url\((.*?)\)", css)[0], ua="")))
    gs, cmap = ttf.getGlyphSet(), ttf.getBestCmap()
    glyf, hmtx = ttf["glyf"], ttf["hmtx"]
    name = lambda ch: cmap[ord(ch)]

    def bounds(rec):
        pen = BoundsPen(gs)
        rec.replay(pen)
        return pen.bounds

    def record(glyph, t=(1, 0, 0, 1, 0, 0), drop_dot=False):
        rec = RecordingPen()
        gs[glyph].draw(rec)
        if drop_dot:  # i sem pingo: tira o contorno mais alto
            contours, cur = [], []
            for op in rec.value:
                cur.append(op)
                if op[0] in ("closePath", "endPath"):
                    contours.append(cur)
                    cur = []
            contours.sort(key=lambda c: min((p[1] for _, pts in c for p in pts), default=0))
            rec.value = [op for c in contours[:-1] for op in c]
        out = RecordingPen()
        rec.replay(TransformPen(out, t))
        return out

    def join(*recs):
        out = RecordingPen()
        for r in recs:
            out.value += r.value
        return out

    def move(rec, dx, dy):
        out = RecordingPen()
        rec.replay(TransformPen(out, (1, 0, 0, 1, dx, dy)))
        return out

    def rotate(deg, scale=1.0):
        a = math.radians(deg)
        return (scale * math.cos(a), scale * math.sin(a), -scale * math.sin(a), scale * math.cos(a), 0, 0)

    accents = {
        "acute": lambda: record(name("'"), rotate(-38, 0.9)),
        "grave": lambda: record(name("`"), (0.95, 0, 0, 0.95, 0, 0)),
        "circumflex": lambda: record(name("^"), (0.62, 0, 0, 0.55, 0, 0)),
        "tilde": lambda: record(name("~"), (0.58, 0, 0, 0.62, 0, 0)),
        "dieresis": lambda: join(record(name(".")), record(name("."), (1, 0, 0, 1, 120, 0))),
        "macron": lambda: record(name("-"), (0.75, 0, 0, 0.8, 0, 0)),
    }
    new = {}

    def compose(ch, base, accent, drop_dot=False):
        b = record(name(base), drop_dot=drop_dot)
        bx0, _, bx1, by1 = bounds(b)
        a = accents[accent]()
        ax0, ay0, ax1, _ = bounds(a)
        gap = 45 if base.islower() else 40
        new[ch] = (join(b, move(a, (bx0 + bx1) / 2 - (ax0 + ax1) / 2, by1 + gap - ay0)), hmtx[name(base)][0])

    table = {
        "á": ("a", "acute"), "à": ("a", "grave"), "â": ("a", "circumflex"), "ã": ("a", "tilde"), "ä": ("a", "dieresis"),
        "é": ("e", "acute"), "è": ("e", "grave"), "ê": ("e", "circumflex"), "ë": ("e", "dieresis"),
        "ó": ("o", "acute"), "ò": ("o", "grave"), "ô": ("o", "circumflex"), "õ": ("o", "tilde"), "ö": ("o", "dieresis"),
        "ú": ("u", "acute"), "ù": ("u", "grave"), "û": ("u", "circumflex"), "ü": ("u", "dieresis"),
        "ñ": ("n", "tilde"),
        "Á": ("A", "acute"), "À": ("A", "grave"), "Â": ("A", "circumflex"), "Ã": ("A", "tilde"), "Ä": ("A", "dieresis"),
        "É": ("E", "acute"), "È": ("E", "grave"), "Ê": ("E", "circumflex"), "Ë": ("E", "dieresis"),
        "Í": ("I", "acute"), "Ì": ("I", "grave"), "Î": ("I", "circumflex"), "Ï": ("I", "dieresis"),
        "Ó": ("O", "acute"), "Ò": ("O", "grave"), "Ô": ("O", "circumflex"), "Õ": ("O", "tilde"), "Ö": ("O", "dieresis"),
        "Ú": ("U", "acute"), "Ù": ("U", "grave"), "Û": ("U", "circumflex"), "Ü": ("U", "dieresis"),
        "Ñ": ("N", "tilde"),
        "ō": ("o", "macron"), "Ō": ("O", "macron"),
    }
    for ch, (base, accent) in table.items():
        compose(ch, base, accent)
    for ch, accent in (("í", "acute"), ("ì", "grave"), ("î", "circumflex"), ("ï", "dieresis")):
        compose(ch, "i", accent, drop_dot=True)

    for ch, base in (("ç", "c"), ("Ç", "C")):  # a vírgula da própria fonte pendurada embaixo do c
        b = record(name(base))
        bx0, by0, bx1, _ = bounds(b)
        c = record(name(","), (0.8, 0, 0, 0.75, 0, 0))
        cx0, _, cx1, cy1 = bounds(c)
        new[ch] = (join(b, move(c, (bx0 + bx1) / 2 - (cx0 + cx1) / 2, by0 + 10 - cy1)), hmtx[name(base)][0])

    # Sinais de abertura do espanhol: o ? e o ! da própria fonte de cabeça para baixo, pendurados na altura do x.
    xtop = bounds(record(name("x")))[3]
    for ch, base in (("¿", "?"), ("¡", "!")):
        g = record(name(base), (-1, 0, 0, -1, 0, 0))
        gx0, _, gx1, gy1 = bounds(g)
        adv = hmtx[name(base)][0]
        new[ch] = (move(g, adv / 2 - (gx0 + gx1) / 2, xtop - gy1), adv)

    period = record(name("."))
    px0, py0, _, _ = bounds(period)
    hyphen = hmtx[name("-")][0]
    new["·"] = (move(period, 0, 300 - py0), hmtx[name(".")][0])
    new["•"] = (move(record(name("."), (1.4, 0, 0, 1.4, 0, 0)), 0, 240), hmtx[name(".")][0])
    new["…"] = (join(*(move(period, i * 150, 0) for i in range(3))), 500)
    new["–"] = (record(name("-"), (1.6, 0, 0, 1, -12, 0)), int(hyphen * 1.55))
    new["—"] = (record(name("-"), (2.7, 0, 0, 1, -30, 0)), int(hyphen * 2.6))
    new["−"] = (record(name("-")), hyphen)
    new["×"] = (join(record(name("-"), rotate(45, 0.7)), record(name("-"), rotate(-45, 0.7))), hyphen)
    small = (0.6, 0, 0, 0.6, 0, 0)
    bar = record(name("-"), (0.9, 0, 0, 0.7, 0, 0))
    tx0, ty0, _, _ = bounds(bar)
    for ch, base, adv in (("ª", "a", 260), ("º", "o", 270)):
        g = record(name(base), small)
        gx0, gy0, _, _ = bounds(g)
        new[ch] = (join(move(g, 20 - gx0, 420 - gy0), move(bar, 20 - tx0, 360 - ty0)), adv)
    o = record(name("o"), (0.5, 0, 0, 0.5, 0, 0))
    ox0, oy0, _, _ = bounds(o)
    new["°"] = (move(o, 20 - ox0, 470 - oy0), 220)

    order = ttf.getGlyphOrder()
    for ch, (rec, adv) in new.items():
        gname = f"uni{ord(ch):04X}"
        pen = TTGlyphPen(None)
        rec.replay(pen)
        glyph = pen.glyph()
        glyph.recalcBounds(glyf)
        glyf[gname] = glyph
        if gname not in order:
            order.append(gname)
        hmtx[gname] = (adv, glyph.xMin if glyph.numberOfContours else 0)
        for t in ttf["cmap"].tables:
            if t.isUnicode():
                t.cmap[ord(ch)] = gname
    ttf.setGlyphOrder(order)

    buf = io.BytesIO()
    ttf.save(buf)
    buf.seek(0)
    font = TTFont(buf)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + [ord(c) for c in "–—‘’“”…•−€ōŌ"])
    sub.subset(font)
    font.flavor = "woff2"
    font.save(OUT / "nanum-pen-script-pt.woff2")
    return [("Nanum Pen Script", "normal", "400", None, "nanum-pen-script-pt.woff2", None)]


# Sinais que uma família pode não ter porque a fonte seguinte na pilha do CSS desenha: os títulos
# (Oferta do Dia) pegam estes poucos da Familjen Grotesk, letra por letra.
MAY_LACK = {"Oferta do Dia": "ōŌªº°·–—•×", "Londrina Solid": "ōŌ"}


def used_characters():
    """Todo caractere que o site escreve: os textos dos três idiomas e de src/content."""
    chars = set()
    for folder in (ROOT / "src" / "i18n", ROOT / "src" / "content"):
        for f in folder.glob("*.json"):
            chars.update(f.read_text(encoding="utf-8"))
    chars.update(REQUIRED)
    return sorted(c for c in chars if ord(c) >= 0x20)


def oferta():
    """Sem ela = os títulos usam a reserva. Sem permissão da autora, o original byte a
    byte; com ela (PERMISSAO.txt), um WOFF2 só com os caracteres que o site usa."""
    family, source, target = OFERTA
    src = ORIGINALS / source
    if not src.exists():
        print(f"{family}: arquivo original ausente em {src}; os títulos usam a fonte reserva")
        return []
    if not PERMISSION.exists():
        (OUT / target).write_bytes(src.read_bytes())
        print(f"{family}: sem a permissão do autor, vai o TTF original, sem recorte")
        return [(family, "normal", "400", None, target, None)]
    font = TTFont(src)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    sub = subset.Subsetter(opts)
    sub.populate(text="".join(used_characters()))
    sub.subset(font)
    font.flavor = "woff2"
    woff2 = "oferta-do-dia.woff2"
    font.save(OUT / woff2)
    print(f"{family}: WOFF2 recortado ({(OUT / woff2).stat().st_size // 1024} KB)")
    return [(family, "normal", "400", None, woff2, None)]


def coverage(faces):
    by_family = {}
    for family, _, _, _, file, _ in faces:
        cmap = TTFont(OUT / file).getBestCmap()
        by_family.setdefault(family, set()).update(cmap)
    problems = {f: "".join(c for c in REQUIRED if ord(c) not in cps and c not in MAY_LACK.get(f, "")) for f, cps in by_family.items()}
    return {f: m for f, m in problems.items() if m}


def face_line(family, style, weight, stretch, file, urange):
    return (
        "@font-face{"
        f'font-family:"{family}";font-style:{style};font-weight:{weight};'
        + (f"font-stretch:{stretch};" if stretch else "")
        + f'font-display:swap;src:url("/fonts/{file}") format("{"truetype" if file.endswith(".ttf") else "woff2"}");'
        + (f"unicode-range:{urange};" if urange else "")
        + "}"
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    only = None
    if "--so" in sys.argv:
        only = {f.strip() for f in sys.argv[sys.argv.index("--so") + 1].split(",")}
    wanted = lambda family: only is None or family in only
    before = set(OUT.glob("*.woff2")) | set(OUT.glob("*.ttf"))  # só sai depois que o conjunto novo estiver completo
    faces = []
    for family, query, slug in GOOGLE:
        if not wanted(family):
            continue
        faces += google_family(family, query, slug)
        print(f"{family}: ok")
    if wanted("Nanum Pen Script"):
        faces += patch_nanum()
        print("Nanum Pen Script: ok (acentos compostos)")
    if wanted(OFERTA[0]):
        faces += oferta()

    lines = ["/* Gerado por scripts/fonts/build_fonts.py. Não edite à mão. */"]
    if only is not None and CSS.exists():
        # mantém no lugar as famílias que não foram refeitas agora
        kept = [l for l in CSS.read_text(encoding="utf-8").splitlines()[1:] if l and not any(f'font-family:"{f}"' in l for f in only)]
        lines += kept
    lines += [face_line(*face) for face in faces]
    CSS.parent.mkdir(parents=True, exist_ok=True)
    CSS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    # um download que falhou nunca chega aqui, então o site fica com as fontes que tinha
    if only is None:
        for old in before - {OUT / f for _, _, _, _, f, _ in faces}:
            old.unlink()

    if only is not None:
        # as famílias mantidas de antes também contam
        faces += [(m.group(1), "", "", None, m.group(2), None) for m in re.finditer(r'font-family:"([^"]+)".*?url\("/fonts/([^"]+)"\)', CSS.read_text(encoding="utf-8")) if m.group(1) not in only and (OUT / m.group(2)).exists()]
    missing = coverage(faces)
    total = sum(p.stat().st_size for p in OUT.glob("*.woff2"))
    print(f"{len(list(OUT.glob('*.woff2')))} arquivos, {total // 1024} KB")
    if missing:
        for family, chars in missing.items():
            print(f"FALTA em {family}: {chars}")
        sys.exit(1)
    print("cobertura: todas as famílias desenham todos os caracteres exigidos")


if __name__ == "__main__":
    main()
