import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from text2path import text_path
from brand import C, WAVE, defs, mark_body

J = 'fonts/fontsource-jetbrains-mono-5.3.0/package/files/jetbrains-mono-'
def jb(w): return [J + f'latin-{w}-normal.woff2', J + f'cyrillic-{w}-normal.woff2']
FONT = jb(700)
OUT = 'out'
NAME = 'Electricity Monitor'


def mark_svg(small=False, title=NAME):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="{title}">
  {mark_body('m', small)}
</svg>
'''


def mono_svg():
    # single colour via currentColor; wave and dot knocked out of the tile
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="{NAME}">
  <defs><mask id="k" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/>
    <path d="{WAVE}" fill="none" stroke="#000" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="52" cy="22" r="5.5" fill="#000"/></mask></defs>
  <rect width="64" height="64" rx="14" fill="currentColor" mask="url(#k)"/>
</svg>
'''


def maskable():
    # full-bleed square, artwork inside the 80% safe zone
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="{C['tile']}"/>
  <g transform="translate(9.6 9.6) scale(0.7)">{mark_body('x', tile=False)}</g>
</svg>
'''


def words(text_a, text_b, size, x0, y):
    da, wa = text_path(text_a, FONT, size, x0, y)
    space = size * 0.6
    db, wb = text_path(text_b, FONT, size, x0 + wa + space, y)
    end = x0 + wa + space + wb
    return da, db, end


def cursor(x, y, size, fill_attr):
    # terminal underscore cursor sitting on the baseline
    return f'<rect {fill_attr} x="{x + size * 0.18:.1f}" y="{y - size * 0.1:.1f}" width="{size * 0.55:.1f}" height="{size * 0.14:.1f}" rx="1"/>'


def lockup(text_a, text_b, dark, name):
    size = 23; y = 40.5; x0 = 80
    da, db, end = words(text_a, text_b, size, x0, y)
    W = round(end + size * 0.85)
    fa, fb, fc = (C['fgD'], C['signal'], C['cyan']) if dark else (C['fgL'], C['signalL'], C['cyanL'])
    s = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 64" width="{W}" height="64" role="img" aria-label="{text_a} {text_b}">
  {mark_body('l')}
  <path fill="{fa}" d="{da}"/>
  <path fill="{fb}" d="{db}"/>
  {cursor(end, y, size, f'fill="{fc}"')}
</svg>
'''
    open(f'{OUT}/{name}.svg', 'w').write(s)


def adaptive_lockup(text_a, text_b, name):
    size = 23; y = 40.5; x0 = 80
    da, db, end = words(text_a, text_b, size, x0, y)
    W = round(end + size * 0.85)
    s = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 64" width="{W}" height="64" role="img" aria-label="{text_a} {text_b}">
  <style>.a{{fill:{C['fgL']}}}.b{{fill:{C['signalL']}}}.c{{fill:{C['cyanL']}}}@media (prefers-color-scheme:dark){{.a{{fill:{C['fgD']}}}.b{{fill:{C['signal']}}}.c{{fill:{C['cyan']}}}}}</style>
  {mark_body('l')}
  <path class="a" d="{da}"/>
  <path class="b" d="{db}"/>
  {cursor(end, y, size, 'class="c"')}
</svg>
'''
    open(f'{OUT}/{name}.svg', 'w').write(s)


def backdrop(W, H, gid, step=40):
    # dark ground, faint grid, soft cyan glow
    return f'''<defs>
    <radialGradient id="{gid}g" cx="0.5" cy="0.4" r="0.6"><stop offset="0" stop-color="{C['cyan']}" stop-opacity=".14"/><stop offset="1" stop-color="{C['bg']}" stop-opacity="0"/></radialGradient>
    <pattern id="{gid}p" width="{step}" height="{step}" patternUnits="userSpaceOnUse"><path d="M{step} 0H0V{step}" fill="none" stroke="{C['signal']}" stroke-opacity=".06"/></pattern></defs>
  <rect width="{W}" height="{H}" fill="{C['bg']}"/>
  <rect width="{W}" height="{H}" fill="url(#{gid}p)"/>
  <rect width="{W}" height="{H}" fill="url(#{gid}g)"/>'''


def side_waves(W, y, x_left, x_right, scale):
    # square-wave trace running in from both edges toward the mark
    hi, lo = y - 18 * scale / 3, y
    l = f'M0 {lo:g} H{x_left - 160:g} V{hi:g} H{x_left - 90:g} V{lo:g} H{x_left:g}'
    r = f'M{x_right:g} {lo:g} H{x_right + 90:g} V{hi:g} H{x_right + 160:g} V{lo:g} H{W}'
    return f'<path d="{l} {r}" fill="none" stroke="{C["signal"]}" stroke-opacity=".28" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'


def og(text_a, text_b, tagline, name):
    W, H = 1200, 630
    size = 58
    _, _, end = words(text_a, text_b, size, 0, 0)
    tw = end + size * 0.75
    x = (W - tw) / 2
    da, db, end = words(text_a, text_b, size, x, 452)
    tag = '> ' + tagline
    _, wt = text_path(tag, jb(500), 26, 0, 0)
    dt, _ = text_path(tag, jb(500), 26, (W - wt) / 2, 512)
    ms = 3; mx, my = (W - 64 * ms) / 2, 150
    s = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
  {backdrop(W, H, 'o')}
  {side_waves(W, my + 40 * ms, mx - 40, mx + 64 * ms + 40, ms)}
  <g transform="translate({mx:g} {my}) scale({ms})">{mark_body('o')}</g>
  <path fill="{C['fgD']}" d="{da}"/><path fill="{C['signal']}" d="{db}"/>
  {cursor(end, 452, size, f'fill="{C["cyan"]}"')}
  <path fill="{C['mutD']}" d="{dt}"/>
</svg>
'''
    open(f'{OUT}/{name}.svg', 'w').write(s)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    open(f'{OUT}/logo-mark.svg', 'w').write(mark_svg())
    open(f'{OUT}/favicon.svg', 'w').write(mark_svg(small=True))
    open(f'{OUT}/logo-mark-mono.svg', 'w').write(mono_svg())
    open(f'{OUT}/icon-maskable.svg', 'w').write(maskable())
    for lang, (a, b) in dict(en=('Electricity', 'Monitor'), uk=('Монітор', 'електрики'), ru=('Монитор', 'электричества')).items():
        lockup(a, b, False, f'logo-{lang}-light')
        lockup(a, b, True, f'logo-{lang}-dark')
        adaptive_lockup(a, b, f'logo-{lang}')
    og('Electricity', 'Monitor', 'Know the moment the power goes out', 'og-image-en')
    og('Монітор', 'електрики', 'Дізнайтеся, щойно зникло світло', 'og-image-uk')
    og('Монитор', 'электричества', 'Узнайте, как только пропал свет', 'og-image-ru')
    print('ok')
