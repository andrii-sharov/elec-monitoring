import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from brand import C, WAVE, defs, mark_body
from gen import backdrop, side_waves
OUT = 'out'

LIGHT = dict(a='#4D7A00', f='#0B1015', m='#4F6070', s='#FFFFFF', b='#D3DCE2',
             on='#4D7A00', off='#C62828', pend='#5E6E7C', w='#8A5A00')
DARK = dict(a='#C8F560', f='#E8F0F4', m='#93A4B0', s='#151E27', b='#2A3742',
            on='#C8F560', off='#FF7A7A', pend='#8FA3B8', w='#FFC857')
TOKENS = dict(a='primary', f='foreground', m='muted-foreground', s='surface', b='border',
              on='status-online', off='status-offline', pend='status-pending', w='warning')


def themed_style():
    light = ';'.join(f'--em-{k}:{v}' for k, v in LIGHT.items())
    dark = ';'.join(f'--em-{k}:{v}' for k, v in DARK.items())
    rules = ''.join(
        f'.em-ill .{k}{{fill:var(--{t},var(--em-{k}))}}.em-ill .{k}-s{{stroke:var(--{t},var(--em-{k}))}}'
        for k, t in TOKENS.items())
    return (f'<style>.em-ill{{{light}}}@media (prefers-color-scheme:dark){{.em-ill{{{dark}}}}}'
            f'.dark .em-ill{{{dark}}}{rules}</style>')


def illustration(name, label, body):
    s = f'''<svg xmlns="http://www.w3.org/2000/svg" class="em-ill" viewBox="0 0 240 160" width="240" height="160" role="img" aria-label="{label}">
  {themed_style()}
  <defs>{defs(name)}</defs>
  <g fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
{body}
  </g>
</svg>
'''
    open(f'{OUT}/{name}.svg', 'w').write(s)


def bolt_at(cx, cy, scale):
    # brand square wave + live dot, centred on (cx, cy)
    tx, ty = cx - 30 * scale, cy - 31 * scale
    return (f'<g transform="translate({tx:g} {ty:g}) scale({scale:g})"><path d="{WAVE}" fill="none" stroke="{C["signal"]}" stroke-width="5"/>'
            f'<circle cx="52" cy="22" r="5" fill="{C["cyan"]}" stroke="none"/></g>')


def not_found():
    illustration('not-found', 'Unplugged cable', f'''    <path class="a-s" d="M16 96 H40 V82 H62 V96 H92"/>
    <rect class="a" x="92" y="84" width="24" height="24" rx="6"/>
    <path class="m-s" d="M116 91 H126 M116 101 H126"/>
    <path class="pend-s" d="M132 96 H146" stroke-dasharray="1 6"/>
    <rect class="s b-s" x="152" y="66" width="60" height="60" rx="16"/>
    <circle class="b-s" cx="182" cy="96" r="18"/>
    <circle class="m" cx="175" cy="96" r="3.5"/>
    <circle class="m" cx="189" cy="96" r="3.5"/>
    <circle class="pend" cx="212" cy="66" r="6"/>''')


def history_empty():
    days = '\n'.join(
        f'    <rect class="on" x="{28 + i * 27}" y="104" width="23" height="24" rx="6" fill-opacity="{0.55 + i * 0.07:.2f}"/>'
        for i in range(7))
    illustration('history-empty', 'A calm week with no outages', f'''    <path class="a-s" d="M28 62 H52 V48 H74 V62 H98 M142 62 H212"/>
    <circle class="on" cx="120" cy="62" r="18"/>
    <path class="s-s" stroke-width="4" d="M111 62 L117.5 68.5 L130 55.5"/>
{days}''')


def channels_empty():
    illustration('channels-empty', 'No notification channel yet', f'''    <path fill="{C['tile']}" d="M52 46 H92 A16 16 0 0 1 108 62 V84 A16 16 0 0 1 92 100 H70 L46 116 L52 100 A16 16 0 0 1 36 84 V62 A16 16 0 0 1 52 46 Z"/>
    {bolt_at(72, 73, 0.72)}
    <path class="m-s" d="M118 73 H142" stroke-dasharray="1 7"/>
    <circle class="b-s" cx="176" cy="73" r="26" stroke-dasharray="6 6"/>
    <path class="a-s" d="M176 62 V84 M165 73 H187"/>''')


def full_bleed(uid, size):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{size}" height="{size}">
  <rect width="64" height="64" fill="{C['tile']}"/>
  <g transform="translate(9.6 9.6) scale(0.7)">{mark_body(uid, tile=False)}</g>
</svg>
'''


def banner(name, W, H, mark_scale):
    m = 64 * mark_scale
    x, y = (W - m) / 2, (H - m) / 2
    s = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
  {backdrop(W, H, 'd', 32)}
  {side_waves(W, y + 40 * mark_scale, x - 36, x + m + 36, mark_scale)}
  <g transform="translate({x:g} {y:g}) scale({mark_scale:g})">{mark_body('d')}</g>
</svg>
'''
    open(f'{OUT}/{name}.svg', 'w').write(s)


def minified_mark():
    s = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="40" height="40" aria-hidden="true"><defs>{defs('p')}</defs>{mark_body('p', small=True)}</svg>'''
    s = re.sub(r'>\s+<', '><', s).replace(' class="wave"', '').replace(' class="dot"', '').replace('<defs></defs>', '')
    open(f'{OUT}/portal-mark.svg', 'w').write(s + '\n')


os.makedirs(OUT, exist_ok=True)
not_found()
history_empty()
channels_empty()
open(f'{OUT}/bot-avatar.svg', 'w').write(full_bleed('t', 640))
banner('bot-description', 640, 360, 2.6)
minified_mark()
print('ok')
