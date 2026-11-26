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
