import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
_cache={}
def font(path):
    if path not in _cache: _cache[path]=TTFont(path)
    return _cache[path]
def text_path(text, fontpaths, size, x=0, y=0, tracking=0):
    if isinstance(fontpaths,str): fontpaths=[fontpaths]
    fs=[font(p) for p in fontpaths]
    out=[]; cx=x
    for ch in text:
        for f in fs:
            g=f.getBestCmap().get(ord(ch))
            if g: break
        if g is None: raise ValueError('missing '+ch)
        s=size/f['head'].unitsPerEm; gs=f.getGlyphSet()
        pen=SVGPathPen(gs, ntos=lambda v: ("%.2f" % v).rstrip("0").rstrip(".")); tp=TransformPen(pen,(s,0,0,-s,cx,y)); gs[g].draw(tp)
        out.append(pen.getCommands())
        cx+=f['hmtx'][g][0]*s+tracking
    return ' '.join(c for c in out if c), cx-x-tracking
