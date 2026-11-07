# Writes Seismic's sign and wordmark as files: uv run scripts/logo.py
# src/ui/logo/seismic_logo.png is the one source. From it: logo.svg (the favicon), wordmark.svg and
# wordmark-dark.svg (the sign with "Seismic" in Newsreader SemiBold as outlines, the letters in the ink of
# either theme), logo.png (where SVG is not taken), apple-touch-icon.png and icon-512.png (the sign on a
# square for home screens), glyphs.ts (what the UI's Sign and Wordmark draw), the site's copies in
# site/img/ and the app's icons in app/icons/.
# /// script
# dependencies = ["pillow", "fonttools", "brotli"]
# ///
import base64, io, json, shutil
from pathlib import Path
from PIL import Image, ImageDraw
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

root = Path(__file__).resolve().parent.parent
logo_dir = root / 'src/ui/logo'
site_img = root / 'site/img'
icons = root / 'app/icons'
BG = (11, 18, 32)  # the ink the sign sits on in icons: the sign is light, so it needs a dark square

src = Image.open(logo_dir / 'seismic_logo.png').convert('RGBA')
# the sign without its empty margin, centred on a square
alpha = src.getchannel('A').point(lambda a: 255 if a > 40 else 0)
sign = src.crop(alpha.getbbox())
side = max(sign.size)
square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square.paste(sign, ((side - sign.width) // 2, (side - sign.height) // 2))

def png_bytes(im):
    b = io.BytesIO()
    im.save(b, 'PNG', optimize=True)
    return b.getvalue()

def sized(px):
    return square.resize((px, px), Image.LANCZOS)

data_uri = 'data:image/png;base64,' + base64.b64encode(png_bytes(sized(192))).decode()

# the letters, as outlines, at 2000 units per em like the cards' titles' font
font = instancer.instantiateVariableFont(TTFont(root / 'site/fonts/newsreader-latin-opsz-normal.woff2'), {'wght': 600, 'opsz': 24})
gs, cmap = font.getGlyphSet(), font.getBestCmap()
SCALE, X0, GAP = 0.0142, 37.0, 0.3
x, letters = X0, []
for ch in 'Seismic':
    name = cmap[ord(ch)]
    pen = SVGPathPen(gs)
    gs[name].draw(TransformPen(pen, (1, 0, 0, -1, 0, 0)))
    letters.append([round(x, 2), pen.getCommands()])
    x += gs[name].width * SCALE + GAP
word_w = round(x + 1, 2)

(logo_dir / 'glyphs.ts').write_text(
    '// Written by scripts/logo.py from seismic_logo.png and the wordmark font: do not edit.\n'
    f'export const SIGN = {json.dumps(data_uri)};\n'
    f'export const GLYPH_SCALE = {SCALE};\n'
    f'export const WORD_W = {word_w};\n'
    f'export const LETTERS: [number, string][] = {json.dumps(letters, indent=2)};\n'
)

sign_svg = f'<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><image width="32" height="32" href="{data_uri}"/></svg>\n'
def wordmark(ink):
    paths = ''.join(f'<path transform="translate({lx} 24) scale({SCALE})" d="{d}" fill="{ink}"/>' for lx, d in letters)
    return (f'<svg height="32" width="{round(word_w, 1)}" viewBox="0 0 {word_w} 32" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Seismic">'
            f'<image width="32" height="32" href="{data_uri}"/>{paths}</svg>\n')
files = {'logo.svg': sign_svg, 'wordmark.svg': wordmark('#1f1b14'), 'wordmark-dark.svg': wordmark('#efe9dc')}
for name, svg in files.items():
    (logo_dir / name).write_text(svg)
    (site_img / name).write_text(svg)

def on_square(px, margin, radius=0.0):
    """The sign on a dark square of `px`, `margin` being the share of the width left empty on each side."""
    big = px * 4
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * radius), fill=255)
    im.paste(Image.new('RGBA', (big, big), BG + (255,)), mask=mask)
    inner = int(big * (1 - 2 * margin))
    s = square.resize((inner, inner), Image.LANCZOS)
    im.alpha_composite(s, ((big - inner) // 2, (big - inner) // 2))
    return im.resize((px, px), Image.LANCZOS)

sized(64).save(logo_dir / 'logo.png', optimize=True)
touch = on_square(180, 0.16).convert('RGB')
touch.save(logo_dir / 'apple-touch-icon.png', optimize=True)
touch.save(site_img / 'apple-touch-icon.png', optimize=True)
on_square(512, 0.16).convert('RGB').save(logo_dir / 'icon-512.png', optimize=True)

# an app icon is the sign on a rounded square, with the margin macOS draws its icons with
app = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
app.alpha_composite(on_square(824, 0.18, 0.225), (100, 100))
app.save(icons / 'source.png', optimize=True)
for name, px in {'32x32.png': 32, '128x128.png': 128, '128x128@2x.png': 256, 'icon.png': 512}.items():
    app.resize((px, px), Image.LANCZOS).save(icons / name, optimize=True)
app.save(icons / 'icon.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 256)])
app.save(icons / 'icon.icns')
