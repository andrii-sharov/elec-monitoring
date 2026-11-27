# Palette: Neon Grid (assets/BRAND.md). Dark-first; the mark keeps these fixed colours in every theme.
C = dict(
    tile='#151E27', edge='#2A3742',          # mark tile + hairline border
    signal='#C8F560', cyan='#5CE1E6',        # square wave + live dot
    bg='#0B1015', surface='#151E27', card='#1D2833', border='#2A3742',
    fgD='#E8F0F4', mutD='#93A4B0', outage='#FF7A7A', lamp='#FFC857',
    # light-surface variants (text-safe on white, 4.5:1+)
    fgL='#0B1015', mutL='#4F6070', signalL='#4D7A00', cyanL='#00808A',
    primL='#4D7A00', primD='#C8F560',
)

# Square-wave signal: steps between OFF (low) and ON (high), ends at the live dot.
WAVE = 'M8 40 H20 V22 H38 V40 H46 V22 H52'
WAVE_SMALL = 'M6 42 H22 V22 H52'          # one clean step for 16-32 px
DOT = (52, 22)


def defs(uid):
    return ''


def mark_body(uid, small=False, tile=True):
    lw = 6.5 if small else 4.5
    wave = WAVE_SMALL if small else WAVE
    r = 6 if small else 4.5
    t = ''
    if tile:
        t = f'<rect width="64" height="64" rx="14" fill="{C["tile"]}"/>'
        if not small:
            t += f'<rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="{C["edge"]}" stroke-width="2"/>'
    return f'''{t}
  <path class="wave" d="{wave}" fill="none" stroke="{C['signal']}" stroke-width="{lw}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle class="dot" cx="{DOT[0]}" cy="{DOT[1]}" r="{r}" fill="{C['cyan']}"/>'''
