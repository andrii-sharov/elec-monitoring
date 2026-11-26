import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from text2path import text_path
F='fonts/fontsource-unbounded-5.3.0/package/files/unbounded-'
FONT=[F+'latin-600-normal.woff2', F+'cyrillic-600-normal.woff2']
OUT='out'

# Palette: Underwater Dream (docs/theme.md) + derived brand shades
C=dict(bgA='#1D78A8', bgB='#0F4664', line='#92CBE6', bolt='#F1C677', dot='#79DEB2',
       primL='#166088', fgL='#203844', primD='#92CBE6', fgD='#E6F1F5')

def defs(uid):
    return f'''<linearGradient id="{uid}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{C['bgA']}"/><stop offset="1" stop-color="{C['bgB']}"/></linearGradient>'''

BOLT='M36 9 L23 36 H32 L28 55 L43 27 H34 Z'
def mark_body(uid, small=False):
    lw = 5.5 if small else 4
    left = 'M5 34 H30' if small else 'M6 34 H10 L14.5 27.5 L19 34 H30'
    return f'''<rect width="64" height="64" rx="15" fill="url(#{uid}bg)"/>
  <mask id="{uid}gap" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><path d="{BOLT}" fill="#000" stroke="#000" stroke-width="6" stroke-linejoin="round"/></mask>
  <g mask="url(#{uid}gap)" class="pulse">
  <path d="{left}" fill="none" stroke="{C['line']}" stroke-width="{lw}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M34 34 H58" fill="none" stroke="{C['line']}" stroke-width="{lw}" stroke-linecap="round"/>
  </g>
  <path d="{BOLT}" fill="{C['bolt']}" stroke="{C['bolt']}" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="51" cy="13" r="{5.5 if small else 4.5}" fill="{C['dot']}"/>'''

def mark_svg(small=False, title='Electricity Monitor'):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="{title}">
  <defs>{defs('m')}</defs>
  {mark_body('m', small)}
</svg>
'''

def mono_svg():
    # single colour via currentColor; bolt/dot knocked out of the tile
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Electricity Monitor">
  <defs><mask id="k" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/>
    <path d="M7 34 H18 L22 28 L26 34 M38 34 H57" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="{BOLT}" fill="#000" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="51" cy="13" r="4.5" fill="#000"/></mask></defs>
  <rect width="64" height="64" rx="15" fill="currentColor" mask="url(#k)"/>
</svg>
'''

def lockup(text_a, text_b, dark, name):
    size=25; y=41.5; x0=82
    da,wa=text_path(text_a, FONT, size, x0, y)
    space=size*0.32
    db,wb=text_path(text_b, FONT, size, x0+wa+space, y)
    W=round(x0+wa+space+wb+2)
    pa,fg=(C['primD'],C['fgD']) if dark else (C['primL'],C['fgL'])
    s=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 64" width="{W}" height="64" role="img" aria-label="{text_a} {text_b}">
  <defs>{defs('l')}</defs>
  {mark_body('l')}
  <path fill="{pa}" d="{da}"/>
  <path fill="{fg}" d="{db}"/>
</svg>
'''
    open(f'{OUT}/{name}.svg','w').write(s)

def adaptive_lockup(text_a, text_b, name):
    size=25; y=41.5; x0=82
    da,wa=text_path(text_a, FONT, size, x0, y)
    space=size*0.32
    db,wb=text_path(text_b, FONT, size, x0+wa+space, y)
    W=round(x0+wa+space+wb+2)
    s=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 64" width="{W}" height="64" role="img" aria-label="{text_a} {text_b}">
  <style>.a{{fill:{C['primL']}}}.b{{fill:{C['fgL']}}}@media (prefers-color-scheme:dark){{.a{{fill:{C['primD']}}}.b{{fill:{C['fgD']}}}}}</style>
  <defs>{defs('l')}</defs>
  {mark_body('l')}
  <path class="a" d="{da}"/>
  <path class="b" d="{db}"/>
</svg>
'''
    open(f'{OUT}/{name}.svg','w').write(s)

def maskable():
    # full-bleed square, artwork inside 80% safe zone
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>{defs('x')}</defs>
  <rect width="64" height="64" fill="url(#xbg)"/>
  <g transform="translate(9.6 9.6) scale(0.7)">{mark_body('x').split('/>',1)[1]}</g>
</svg>
'''

def og(text_a, text_b, tagline, name):
    W,H=1200,630
    da,wa=text_path(text_a, FONT, 64, 0, 0); db,wb=text_path(text_b, FONT, 64, 0, 0)
    sp=64*0.32; tw=wa+sp+wb
    x=(W-tw)/2
    da,_=text_path(text_a, FONT, 64, x, 448); db,_=text_path(text_b, FONT, 64, x+wa+sp, 448)
    dt,wt=text_path(tagline, [F.replace('unbounded','unbounded')+'latin-500-normal.woff2', F+'cyrillic-500-normal.woff2'], 28, 0, 0)
    dt,_=text_path(tagline, [F+'latin-500-normal.woff2', F+'cyrillic-500-normal.woff2'], 28, (W-wt)/2, 506)
    s=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
  <defs>{defs('o')}
    <radialGradient id="glow" cx="0.5" cy="0.38" r="0.6"><stop offset="0" stop-color="#1D78A8" stop-opacity=".55"/><stop offset="1" stop-color="#101D24" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#92CBE6" stroke-opacity=".07"/></pattern></defs>
  <rect width="{W}" height="{H}" fill="#101D24"/>
  <rect width="{W}" height="{H}" fill="url(#grid)"/>
  <rect width="{W}" height="{H}" fill="url(#glow)"/>
  <path d="M0 261 H420 M780 261 H{W}" stroke="#92CBE6" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>
  <g transform="translate(504 165) scale(3)">{mark_body('o')}</g>
  <path fill="{C['primD']}" d="{da}"/><path fill="{C['fgD']}" d="{db}"/>
  <path fill="#B2C8D1" d="{dt}"/>
</svg>
'''
    open(f'{OUT}/{name}.svg','w').write(s)

os.makedirs(OUT, exist_ok=True)
open(f'{OUT}/logo-mark.svg','w').write(mark_svg())
open(f'{OUT}/favicon.svg','w').write(mark_svg(small=True))
open(f'{OUT}/logo-mark-mono.svg','w').write(mono_svg())
open(f'{OUT}/icon-maskable.svg','w').write(maskable())
lockup('Electricity','Monitor',False,'logo-en-light')
lockup('Electricity','Monitor',True,'logo-en-dark')
adaptive_lockup('Electricity','Monitor','logo-en')
lockup('Монітор','електрики',False,'logo-uk-light')
lockup('Монітор','електрики',True,'logo-uk-dark')
adaptive_lockup('Монітор','електрики','logo-uk')
lockup('Монитор','электричества',False,'logo-ru-light')
lockup('Монитор','электричества',True,'logo-ru-dark')
adaptive_lockup('Монитор','электричества','logo-ru')
og('Electricity','Monitor','Know the moment the power goes out','og-image-en')
og('Монітор','електрики','Дізнайтеся, щойно зникло світло','og-image-uk')
og('Монитор','электричества','Узнайте, как только пропал свет','og-image-ru')
print('ok')
